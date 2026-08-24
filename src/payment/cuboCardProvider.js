// CuboCardProvider — the PaymentProvider implementation for card payments
// via Cubo QPOS Cute (Web SDK). See paymentProvider.js for the shared
// contract this implements.
//
// This wraps three modules that already exist and are already tested on
// their own, WITHOUT modifying any of them:
//   - src/cubo/cuboAdapter.js             (mock or real Cubo Web SDK)
//   - src/payment/paymentStateMachine.js  (the safety-critical state machine)
//   - src/esp32/esp32Interface.js         (the PAYMENT_SUCCESS-only guard)
//
// What this file adds is purely the *wiring* between them — translating
// Cubo adapter events into state-machine transitions — which previously
// lived inline in lab/lab.js. Moving it here means the same wiring can be
// unit-tested directly (tests/cuboCardProvider.test.js) instead of only
// through the browser UI, and reused if another screen or machine needs
// the same card flow. lab/lab.js is untouched for now — wiring it to this
// provider is a follow-up, not done speculatively in this pass.

import { createCuboAdapter, CUBO_CURRENCY_ISO4217, CUBO_EVENTS, CUBO_ERROR_TYPES } from '../cubo/cuboAdapter.js';
import { createPaymentSession, STATES, canStartCycle } from './paymentStateMachine.js';
import { requestCycleStart, Esp32NotImplementedError } from '../esp32/esp32Interface.js';
import { log } from '../logger.js';

// Interprets a real transactionResult payload, CONFIRMED shape (see
// webSdkCuboAdapter.js / CUBO-INTEGRATION.md — sourced from Cubo's own
// official demo repo, not guessed):
//   { success: boolean, data?: object, pending?: boolean, message?: string,
//     error?: { type: string, message: string } }
//
// Returns the state-machine event to send, or null to send nothing at
// all (fail-closed: the session stays exactly where it was, which is
// never PAYMENT_SUCCESS, so canStartCycle() stays false).
//
// `pending: true` is the important case this function exists to get
// right: the SDK could not confirm whether the charge went through, and
// its own docs are explicit that retrying automatically risks a double
// charge (the SDK already has its own idempotency-key-based recovery
// mechanism internally — this code must not layer a second retry on top
// of it). So pending returns null on purpose: no transition, no
// automatic retry, canStartCycle() stays false. The caller is only ever
// told via the 'payment_pending' notification (see below) so the UI can
// show result.message and require an explicit human decision.
function interpretTransactionResult(result) {
  if (result.pending) return null;
  if (result.success) return 'SUCCESS';
  if (result.error?.type === CUBO_ERROR_TYPES.TRANSACTION_DECLINED) return 'DECLINED';
  if (result.error) return 'ERROR';
  // Not success, not pending, no error object either — shape doesn't
  // match anything documented. Fail closed rather than guess.
  return null;
}

/**
 * @param {{mode: 'mock'|'web-sdk', machineConfig: object, apiKey?: string}} params
 */
export function createCuboCardProvider({ mode, machineConfig, apiKey }) {
  const adapter = createCuboAdapter({ mode, machineConfig, apiKey });
  const session = createPaymentSession();
  const resultHandlers = new Set();
  let currentService = null;

  function notify(extra) {
    const snapshot = { providerType: 'card', state: session.getState(), ...extra };
    for (const handler of resultHandlers) handler(snapshot);
  }

  adapter.on(CUBO_EVENTS.CONNECTED, () => {
    if (session.getState() === STATES.CONNECTING_POS) session.send('POS_CONNECTED');
    notify({ event: CUBO_EVENTS.CONNECTED });
  });

  adapter.on(CUBO_EVENTS.DISCONNECTED, () => {
    const state = session.getState();
    if (state === STATES.POS_CONNECTED) session.send('POS_DISCONNECTED');
    else if (state === STATES.WAITING_FOR_CARD || state === STATES.PROCESSING_PAYMENT) session.send('ERROR');
    // IDLE / CONNECTING_POS / already-terminal: nothing valid to transition
    // to from here — just notify, don't force a transition.
    notify({ event: CUBO_EVENTS.DISCONNECTED });
  });

  adapter.on(CUBO_EVENTS.ERROR, (payload) => {
    // Confirmed real shape (see webSdkCuboAdapter.js / CUBO-INTEGRATION.md):
    // { type: string, message: string } — there is no `code` field. Reading
    // `.code` here silently discarded Cubo's actual error text (e.g. an
    // auth rejection message) from both the log and the UI.
    log(machineConfig.machineId, 'CuboCardProvider: adapter error event', {
      type: payload?.type,
      message: payload?.message,
    });
    notify({ event: CUBO_EVENTS.ERROR, type: payload?.type, message: payload?.message });
  });

  adapter.on(CUBO_EVENTS.TRANSACTION_RESULT, (result) => {
    // The state machine requires CARD_DETECTED (WAITING_FOR_CARD ->
    // PROCESSING_PAYMENT) before any terminal event is valid. The real SDK
    // doesn't expose a separate "card read" moment before transactionResult
    // — but receiving ANY transactionResult (including a pending one) is
    // itself proof an attempt was made, so treat that as the CARD_DETECTED
    // moment rather than skip straight to the outcome.
    if (session.getState() === STATES.WAITING_FOR_CARD) {
      session.send('CARD_DETECTED');
      notify({ event: 'card_detected' });
    }

    if (result.pending) {
      log(machineConfig.machineId, 'transactionResult pending — not authorizing, not retrying automatically', {
        message: result.message,
      });
      notify({ event: 'payment_pending', message: result.message });
      return;
    }

    const stateEvent = interpretTransactionResult(result);
    if (!stateEvent) {
      log(machineConfig.machineId, 'CuboCardProvider: unrecognized transactionResult shape, not transitioning', {
        success: result.success,
        errorType: result.error?.type,
      });
      notify({ event: CUBO_EVENTS.TRANSACTION_RESULT, result, transitioned: false });
      return;
    }
    session.send(stateEvent);
    notify({ event: CUBO_EVENTS.TRANSACTION_RESULT, result, transitioned: true });
  });

  // The state machine requires SELECT_SERVICE -> SELECT_CARD_PAYMENT before
  // CONNECT_POS is valid (see paymentStateMachine.js) — the same order
  // lab.js already drives through its UI. A card payment can't skip
  // straight from "provider created" to "connect POS" without this step.
  function selectService(service) {
    currentService = service;
    if (session.getState() === STATES.IDLE) session.send('SELECT_SERVICE');
    if (session.getState() === STATES.SERVICE_SELECTED) session.send('SELECT_CARD_PAYMENT');
    notify({ event: 'service_selected', service: service?.label });
  }

  async function connectPos() {
    if (session.getState() !== STATES.PAYMENT_METHOD_SELECTED) {
      throw new Error(
        `connectPos() called from state "${session.getState()}"; selectService() must succeed first.`
      );
    }
    session.send('CONNECT_POS');
    notify({ event: 'connecting' });
    try {
      await adapter.connect();
    } catch (err) {
      session.send('POS_CONNECTION_FAILED');
      notify({ event: 'connect_failed', reason: err.message });
      throw err;
    }
  }

  function disconnectPos() {
    return adapter.disconnect();
  }

  // Service was already fixed by selectService() — startPayment() only
  // needs the mock-only outcome override at test time, everything else
  // comes from the config/service chosen earlier.
  async function createPayment() {
    if (session.getState() !== STATES.POS_CONNECTED) {
      throw new Error(
        `createPayment() called from state "${session.getState()}"; connectPos() must succeed first.`
      );
    }
    if (!currentService) {
      throw new Error('createPayment() called without selectService() first.');
    }
    session.send('START_PAYMENT');
    notify({ event: 'payment_started', service: currentService.label });
    return adapter.startPayment({
      // amount is a STRING of cents (confirmed) — e.g. "2000" for Q20.00,
      // not the number 2000.
      amount: String(Math.round(currentService.amount * 100)),
      currencyCode: CUBO_CURRENCY_ISO4217[machineConfig.currency],
      currencySymbol: 'Q',
      ...(mode === 'mock' && currentService.mockOutcome ? { outcome: currentService.mockOutcome } : {}),
    });
  }

  // Calls the real, confirmed cancelCurrentTransaction() (aborts the
  // in-flight HTTP call) when the adapter exposes it, then transitions our
  // own state machine immediately regardless of what that call returns —
  // whether the real SDK also emits its own event after an abort is
  // UNVERIFIED (see CUBO-INTEGRATION.md), so this doesn't wait on it.
  function cancelPayment() {
    const state = session.getState();
    if (state !== STATES.WAITING_FOR_CARD && state !== STATES.PROCESSING_PAYMENT) {
      throw new Error(`cancelPayment() has nothing to cancel from state "${state}".`);
    }
    const realCancelAccepted = adapter.cancelCurrentTransaction?.() ?? false;
    session.send('CANCEL');
    notify({ event: 'cancelled_locally', realCancelAccepted });
  }

  // Lets a failed attempt (declined/cancelled/error/timeout) try again
  // without forcing a fresh Bluetooth pairing when the POS is still
  // physically connected — reported real friction: after any failure, the
  // only way back to a payable state was RESET, which also tears down the
  // POS connection and re-shows the browser's Bluetooth device picker.
  // Skipping a redundant connect() call when the adapter still reports a
  // live connection is a judgment call, not a documented SDK guarantee —
  // calling connect() again on an already-connected real SDK instance is
  // itself UNVERIFIED behavior (see CUBO-INTEGRATION.md).
  async function retryPayment() {
    const state = session.getState();
    const retryableStates = new Set([
      STATES.PAYMENT_DECLINED,
      STATES.PAYMENT_CANCELLED,
      STATES.PAYMENT_ERROR,
      STATES.PAYMENT_TIMEOUT,
    ]);
    if (!retryableStates.has(state)) {
      throw new Error(`retryPayment() has nothing to retry from state "${state}".`);
    }
    session.send('RETRY');
    notify({ event: 'retry_ready' });

    if (adapter.isConnected?.()) {
      session.send('CONNECT_POS');
      session.send('POS_CONNECTED');
      notify({ event: CUBO_EVENTS.CONNECTED, reused: true });
      return;
    }
    await connectPos();
  }

  // Explicit and separate from the transactionResult handler on purpose:
  // reaching PAYMENT_SUCCESS never auto-starts anything by itself. Whoever
  // holds the provider must call requestCycle() themselves after checking
  // canStartCycle() — see the Skill's security rules.
  function requestCycle() {
    return requestCycleStart({
      machineId: machineConfig.machineId,
      state: session.getState(),
      service: currentService,
    });
  }

  return {
    providerType: 'card',
    selectService,
    connectPos,
    disconnectPos,
    createPayment,
    cancelPayment,
    retryPayment,
    getStatus: () => session.getState(),
    canStartCycle: () => canStartCycle(session.getState()),
    requestCycle,
    onResult(handler) {
      resultHandlers.add(handler);
      return () => resultHandlers.delete(handler);
    },
  };
}

export { Esp32NotImplementedError };
