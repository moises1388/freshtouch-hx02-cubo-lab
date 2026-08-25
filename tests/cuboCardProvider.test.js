import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCuboCardProvider } from '../src/payment/cuboCardProvider.js';
import { STATES } from '../src/payment/paymentStateMachine.js';
import { Esp32NotImplementedError } from '../src/esp32/esp32Interface.js';
import { CUBO_EVENTS, CUBO_ERROR_TYPES } from '../src/cubo/cuboEvents.js';

const machineConfig = { machineId: 'HX02-TEST', cuboPosId: 'POS-TEST', currency: 'GTQ' };
const service = { label: 'BASIC', amount: 20 };

function newProvider() {
  return createCuboCardProvider({ mode: 'mock', machineConfig });
}

async function connected(provider, mockOutcome) {
  provider.selectService({ ...service, mockOutcome });
  await provider.connectPos();
  return provider;
}

test('happy path: select -> connect -> createPayment(SUCCESS) -> canStartCycle true -> requestCycle passes the guard', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');
  assert.equal(provider.getStatus(), STATES.POS_CONNECTED);

  await provider.createPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_SUCCESS);
  assert.equal(provider.canStartCycle(), true);
  assert.throws(() => provider.requestCycle(), Esp32NotImplementedError);
});

// Every non-success transactionResult outcome the mock can produce: none
// of them may ever authorize a cycle.
const nonSuccessOutcomes = ['DECLINED', 'ERROR'];
for (const outcome of nonSuccessOutcomes) {
  test(`outcome=${outcome}: canStartCycle stays false and requestCycle refuses`, async () => {
    const provider = await connected(newProvider(), outcome);
    await provider.createPayment();

    assert.equal(provider.canStartCycle(), false);
    assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);
  });
}

// Regression test for the logging bug found in the formal review of
// FreshTouch CORE's sibling review of this lab: the adapter's standalone
// 'error' event (confirmed real shape { type, message }, no `code` field)
// used to be read as `.code` here, silently discarding Cubo's actual
// error text. This confirms the fix propagates `.type` and `.message`
// end-to-end from the adapter event through to what onResult() delivers.
test('CUBO_EVENTS.ERROR: propagates type and message from the adapter event, not a nonexistent "code" field', async () => {
  const provider = await connected(newProvider(), 'ERROR');

  const errorSnapshot = await new Promise((resolve) => {
    provider.onResult((snap) => {
      if (snap.event === CUBO_EVENTS.ERROR) resolve(snap);
    });
    provider.createPayment();
  });

  assert.equal(errorSnapshot.type, CUBO_ERROR_TYPES.SDK_ERROR);
  assert.equal(errorSnapshot.message, 'Simulated SDK error (mock).');
  assert.equal(errorSnapshot.code, undefined, 'no debe seguir emitiendo un campo "code" que Cubo nunca envía');
});

test('outcome=PENDING: does not transition, does not authorize, and does not retry automatically', async () => {
  const provider = await connected(newProvider(), 'PENDING');
  const pendingSnapshot = await new Promise((resolve) => {
    provider.onResult((snap) => {
      if (snap.event === 'payment_pending') resolve(snap);
    });
    provider.createPayment();
  });

  assert.ok(pendingSnapshot.message);
  // Fail-closed: stays wherever CARD_DETECTED left it, never SUCCESS.
  assert.equal(provider.getStatus(), STATES.PROCESSING_PAYMENT);
  assert.equal(provider.canStartCycle(), false);
  assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);
});

test('connectPos before selectService throws', async () => {
  const provider = newProvider();
  await assert.rejects(() => provider.connectPos());
});

test('createPayment before connectPos throws and never reaches a payable state', async () => {
  const provider = newProvider();
  provider.selectService(service);
  await assert.rejects(() => provider.createPayment());
  assert.equal(provider.canStartCycle(), false);
});

test('disconnect after connecting but before payment ends in PAYMENT_ERROR, not authorized', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');
  await provider.disconnectPos();

  assert.equal(provider.getStatus(), STATES.PAYMENT_ERROR);
  assert.equal(provider.canStartCycle(), false);
  assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);
});

test('cancelPayment mid-flow moves to PAYMENT_CANCELLED, blocks the cycle, and stops the in-flight request', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');

  // Deliberately not awaited yet: createPayment() runs synchronously up to
  // its first internal await, so WAITING_FOR_CARD is already the state by
  // the time this line returns.
  const paymentPromise = provider.createPayment();
  assert.equal(provider.getStatus(), STATES.WAITING_FOR_CARD);

  let cancelSnapshot;
  provider.onResult((snap) => {
    if (snap.event === 'cancelled_locally') cancelSnapshot = snap;
  });
  provider.cancelPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_CANCELLED);
  assert.equal(provider.canStartCycle(), false);
  // Confirms cancelPayment() actually called the adapter's real
  // cancelCurrentTransaction(), not just the local state machine.
  assert.equal(cancelSnapshot.realCancelAccepted, true);

  // Because the request was really cancelled (not just locally forgotten
  // about), the mock never delivers a late transactionResult — the
  // promise resolves cleanly instead of racing a rejected late SUCCESS.
  await paymentPromise;
  assert.equal(provider.getStatus(), STATES.PAYMENT_CANCELLED);
});

test('cancelPayment outside WAITING_FOR_CARD/PROCESSING_PAYMENT throws', () => {
  const provider = newProvider();
  assert.throws(() => provider.cancelPayment(), /has nothing to cancel/);
});

test('retryPayment after a failure reuses the still-live POS connection without reconnecting', async () => {
  const provider = await connected(newProvider(), 'ERROR');
  await provider.createPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_ERROR);

  let connectingSeen = false;
  provider.onResult((snap) => {
    if (snap.event === 'connecting') connectingSeen = true;
  });

  await provider.retryPayment();
  assert.equal(provider.getStatus(), STATES.POS_CONNECTED);
  // The POS never actually disconnected, so retryPayment() should not
  // have gone through connectPos()'s 'connecting' step again.
  assert.equal(connectingSeen, false);

  // And a payment can be attempted again from here, same as after a fresh connect.
  provider.selectService({ ...service, mockOutcome: 'SUCCESS' });
  await provider.createPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_SUCCESS);
});

test('retryPayment reconnects if the POS actually disconnected in the meantime', async () => {
  const provider = await connected(newProvider(), 'ERROR');
  await provider.createPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_ERROR);

  await provider.disconnectPos();

  let connectingSeen = false;
  provider.onResult((snap) => {
    if (snap.event === 'connecting') connectingSeen = true;
  });
  await provider.retryPayment();
  assert.equal(connectingSeen, true);
  assert.equal(provider.getStatus(), STATES.POS_CONNECTED);
});

test('retryPayment outside a failure state throws', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');
  await assert.rejects(() => provider.retryPayment(), /has nothing to retry/);
});

// --- One payment, one cycle: the gap ChatGPT's review flagged (rule 10) ---

test('a successful payment authorizes exactly one cycle; a second requestCycle() for the same payment is refused', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');
  await provider.createPayment();
  assert.equal(provider.canStartCycle(), true);

  // First call: authorized, consumed, then hits the (expected) not-yet-
  // implemented ESP32 transport.
  assert.throws(() => provider.requestCycle(), Esp32NotImplementedError);
  assert.equal(provider.getStatus(), STATES.CYCLE_IN_PROGRESS);
  assert.equal(provider.canStartCycle(), false);

  // Second call, same payment, nothing new happened: must be refused by
  // the ordinary guard message, NOT treated as still-authorized.
  assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);
});

test('declined, cancelled, and pending payments never authorize a cycle', async () => {
  for (const outcome of ['DECLINED', 'ERROR']) {
    const provider = await connected(newProvider(), outcome);
    await provider.createPayment();
    assert.equal(provider.canStartCycle(), false);
    assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);
  }

  const pendingProvider = await connected(newProvider(), 'PENDING');
  await new Promise((resolve) => {
    pendingProvider.onResult((snap) => {
      if (snap.event === 'payment_pending') resolve();
    });
    pendingProvider.createPayment();
  });
  assert.equal(pendingProvider.canStartCycle(), false);
  assert.throws(() => pendingProvider.requestCycle(), /Refused to request cycle start/);
});

test('retrying after a failure does not carry over or improperly grant cycle authorization', async () => {
  const provider = await connected(newProvider(), 'ERROR');
  await provider.createPayment();
  assert.equal(provider.getStatus(), STATES.PAYMENT_ERROR);
  assert.equal(provider.canStartCycle(), false);

  await provider.retryPayment();
  // Reusing the connection must not, by itself, authorize anything.
  assert.equal(provider.canStartCycle(), false);
  assert.throws(() => provider.requestCycle(), /Refused to request cycle start/);

  // Only a genuinely NEW successful payment after the retry may authorize
  // a cycle — and it gets exactly one, same as the very first test above.
  provider.selectService({ ...service, mockOutcome: 'SUCCESS' });
  await provider.createPayment();
  assert.equal(provider.canStartCycle(), true);
  assert.throws(() => provider.requestCycle(), Esp32NotImplementedError);
  assert.equal(provider.canStartCycle(), false);
});

test('reportCycleComplete() returns to IDLE and the next customer can pay again without reconnecting', async () => {
  const provider = await connected(newProvider(), 'SUCCESS');
  await provider.createPayment();
  assert.throws(() => provider.requestCycle(), Esp32NotImplementedError);
  assert.equal(provider.getStatus(), STATES.CYCLE_IN_PROGRESS);

  provider.reportCycleComplete();
  assert.equal(provider.getStatus(), STATES.IDLE);
  assert.equal(provider.canStartCycle(), false);

  // Next customer: select a service, connect (must reuse the still-live
  // POS connection, no new Bluetooth pairing), and pay again.
  let connectingSeen = false;
  provider.onResult((snap) => {
    if (snap.event === 'connecting') connectingSeen = true;
  });
  provider.selectService({ ...service, mockOutcome: 'SUCCESS' });
  await provider.connectPos();
  assert.equal(connectingSeen, false);
  assert.equal(provider.getStatus(), STATES.POS_CONNECTED);

  await provider.createPayment();
  assert.equal(provider.canStartCycle(), true);
});

test('reportCycleComplete() outside CYCLE_IN_PROGRESS throws', () => {
  const provider = newProvider();
  assert.throws(() => provider.reportCycleComplete(), /no cycle is in progress/);
});

test('onResult unsubscribe stops further notifications', async () => {
  const provider = newProvider();
  let calls = 0;
  const unsubscribe = provider.onResult(() => {
    calls++;
  });
  await connected(provider, 'SUCCESS');
  unsubscribe();
  const before = calls;
  await provider.createPayment();
  assert.equal(calls, before);
});
