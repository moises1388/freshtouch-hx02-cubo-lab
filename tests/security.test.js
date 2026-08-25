import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES } from '../src/payment/paymentStateMachine.js';
import { requestCycleStart, Esp32NotImplementedError } from '../src/esp32/esp32Interface.js';

// Every state that must NEVER be allowed to start a machine cycle,
// including ones that sound "close enough": payment screen opened,
// POS connected, card detected/loading, processing, and every terminal
// non-success outcome (declined, cancelled, error, timeout).
const NEVER_START_STATES = [
  STATES.IDLE,
  STATES.SERVICE_SELECTED,
  STATES.PAYMENT_METHOD_SELECTED,
  STATES.CONNECTING_POS,
  STATES.POS_CONNECTED,
  STATES.WAITING_FOR_CARD,
  STATES.PROCESSING_PAYMENT,
  STATES.PAYMENT_DECLINED,
  STATES.PAYMENT_CANCELLED,
  STATES.PAYMENT_ERROR,
  STATES.PAYMENT_TIMEOUT,
  // A cycle already in progress (i.e. this exact payment's authorization
  // was already consumed) must never authorize a second one.
  STATES.CYCLE_IN_PROGRESS,
];

for (const state of NEVER_START_STATES) {
  test(`requestCycleStart refuses when state=${state}`, () => {
    assert.throws(
      () => requestCycleStart({ machineId: 'HX02', state, service: { label: 'BASIC' } }),
      /Refused to request cycle start/
    );
  });
}

test('requestCycleStart passes the safety guard for PAYMENT_SUCCESS (and only then reaches the not-implemented ESP32 transport)', () => {
  assert.throws(
    () =>
      requestCycleStart({
        machineId: 'HX02',
        state: STATES.PAYMENT_SUCCESS,
        service: { label: 'BASIC' },
      }),
    Esp32NotImplementedError
  );
});
