// Simulated Cubo QPOS Cute adapter.
//
// This lab environment has no physical tablet, no Bluetooth, and no real
// Cubo credentials, so real-hardware testing cannot happen from here. This
// mock lets the rest of the stack (state machine, UI, ESP32 guard, logging)
// be built and tested end-to-end today.
//
// Event names and the transactionResult shape mirror what's CONFIRMED
// against Cubo's official demo repo (github.com/Cubo-App/cubo-pos-sdk-web-demo,
// cloned and read directly — see CUBO-INTEGRATION.md and
// webSdkCuboAdapter.js for the full citation). Earlier versions of this
// file emitted a guessed shape ({ status: 'SUCCESS', transactionId,
// readType, ... }) before that source was available — none of those
// field names turned out to be real. transactionResult.data's own
// internal shape on success is still UNVERIFIED (the demo repo only
// describes it as "the full API response"), so the mock's `data` object
// below is a placeholder for the lab's own display purposes, not a claim
// about real field names.

import { log } from '../logger.js';
import { CUBO_ERROR_TYPES } from './cuboEvents.js';

export function createMockCuboAdapter({ machineConfig, simulatedLatencyMs = 900 }) {
  const listeners = new Map();
  let connected = false;
  // A per-invocation cancellation token, not a shared flag. Without this,
  // an overlapping second startPayment() (e.g. cancel -> retry -> pay
  // again, all inside the simulated delay window) would reset a shared
  // "cancelRequested" flag and let a call that should have stopped keep
  // running to completion, emitting a second transactionResult on top of
  // the new call's — corrupting the state machine. Each call owns its own
  // token, so a stale call can never affect a newer one.
  let activeCancelToken = null;

  function emit(event, payload) {
    for (const handler of listeners.get(event) || []) handler(payload);
  }

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
    return () => {
      listeners.set(event, (listeners.get(event) || []).filter((h) => h !== handler));
    };
  }

  async function connect() {
    log(machineConfig.machineId, 'POS connecting (simulated)');
    await delay(simulatedLatencyMs);
    connected = true;
    log(machineConfig.machineId, 'POS connected (simulated)');
    // Real shape confirmed: { deviceName }
    emit('connected', { deviceName: `Simulated QPOS Cute (${machineConfig.cuboPosId || 'mock'})` });
  }

  async function disconnect() {
    connected = false;
    log(machineConfig.machineId, 'POS disconnected (simulated)');
    emit('disconnected', undefined); // real 'disconnected' carries no payload
  }

  // Real method (confirmed): aborts the in-flight HTTP call. Here that
  // means the simulated startPayment() below stops before emitting any
  // transactionResult at all — matching the plausible real behavior of an
  // aborted request never getting a response. The caller (CuboCardProvider)
  // doesn't wait on this to resolve the local state; it transitions
  // immediately via its own cancelPayment().
  function cancelCurrentTransaction() {
    if (!activeCancelToken) return false;
    activeCancelToken.cancelled = true;
    return true;
  }

  /**
   * @param {{amount:string, currencyCode:string, currencySymbol:string, outcome?:'SUCCESS'|'DECLINED'|'PENDING'|'ERROR'}} params
   *   `outcome` is a lab-only override to exercise every result path; the
   *   real SDK obviously has no such parameter. Outcomes were narrowed
   *   from an earlier, guessed set (SUCCESS/DECLINED/CANCELLED/ERROR/
   *   TIMEOUT/TRANSACTION_TERMINATED) to match what transactionResult can
   *   actually carry now that it's confirmed: success, pending, or a
   *   { type, message } error. Local cancellation (cancelPayment()) and
   *   POS disconnection are separate flows, not transactionResult outcomes
   *   — see cuboCardProvider.js.
   */
  async function startPayment({ amount, currencyCode, currencySymbol, outcome = 'SUCCESS' }) {
    if (!connected) {
      throw new Error('startPayment called while POS is not connected (simulated)');
    }

    const myToken = { cancelled: false };
    activeCancelToken = myToken;

    log(machineConfig.machineId, 'Payment started (simulated)', {
      amount,
      currency: currencySymbol,
    });

    await delay(simulatedLatencyMs);
    if (myToken.cancelled) return endCancelled();
    log(machineConfig.machineId, 'Waiting for card (simulated)');

    await delay(simulatedLatencyMs);
    if (myToken.cancelled) return endCancelled();
    log(machineConfig.machineId, 'Processing payment (simulated)');

    await delay(simulatedLatencyMs);
    if (myToken.cancelled) return endCancelled();

    if (activeCancelToken === myToken) activeCancelToken = null;

    if (outcome === 'PENDING') {
      // Confirmed shape: no `data`, no `error` — success is falsy, pending
      // is true, message is the user-facing text to show.
      log(machineConfig.machineId, 'Payment PENDING (simulated) — ambiguous, do not retry');
      emit('transactionResult', {
        success: false,
        pending: true,
        message: 'Simulated: no se pudo confirmar el pago con el banco (mock).',
      });
      return;
    }

    if (outcome === 'DECLINED') {
      const errorPayload = {
        type: CUBO_ERROR_TYPES.TRANSACTION_DECLINED,
        message: 'Simulated: transacción rechazada por el banco (mock).',
      };
      log(machineConfig.machineId, 'Payment DECLINED (simulated)');
      emit('error', errorPayload);
      emit('transactionResult', { success: false, error: errorPayload });
      return;
    }

    if (outcome === 'ERROR') {
      const errorPayload = { type: CUBO_ERROR_TYPES.SDK_ERROR, message: 'Simulated SDK error (mock).' };
      log(machineConfig.machineId, 'Payment ERROR (simulated)');
      emit('error', errorPayload);
      emit('transactionResult', { success: false, error: errorPayload });
      return;
    }

    log(machineConfig.machineId, 'Payment SUCCESS (simulated)');
    emit('transactionResult', {
      success: true,
      // Placeholder only — real field names inside `data` are UNVERIFIED.
      data: {
        transactionId: `MOCK-TXN-${Date.now()}`,
        amount,
        currencySymbol,
        timestamp: nowIso(),
      },
    });

    function endCancelled() {
      if (activeCancelToken === myToken) activeCancelToken = null;
      log(machineConfig.machineId, 'Payment request cancelled via cancelCurrentTransaction (simulated)');
      // No transactionResult emitted — an aborted HTTP call gets no
      // response. cuboCardProvider.cancelPayment() already moved the
      // local state on its own; this just stops the simulated timers.
    }
  }

  return {
    connect,
    disconnect,
    startPayment,
    on,
    isConnected: () => connected,
    cancelCurrentTransaction,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}
