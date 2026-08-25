import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  transition,
  canStartCycle,
  createPaymentSession,
} from '../src/payment/paymentStateMachine.js';

test('happy path IDLE -> ... -> PAYMENT_SUCCESS', () => {
  const session = createPaymentSession();
  session.send('SELECT_SERVICE');
  session.send('SELECT_CARD_PAYMENT');
  session.send('CONNECT_POS');
  session.send('POS_CONNECTED');
  session.send('START_PAYMENT');
  session.send('CARD_DETECTED');
  session.send('SUCCESS');
  assert.equal(session.getState(), STATES.PAYMENT_SUCCESS);
  assert.equal(session.canStartCycle(), true);
});

test('declined path never reaches PAYMENT_SUCCESS', () => {
  const session = createPaymentSession();
  session.send('SELECT_SERVICE');
  session.send('SELECT_CARD_PAYMENT');
  session.send('CONNECT_POS');
  session.send('POS_CONNECTED');
  session.send('START_PAYMENT');
  session.send('CARD_DETECTED');
  session.send('DECLINED');
  assert.equal(session.getState(), STATES.PAYMENT_DECLINED);
  assert.equal(session.canStartCycle(), false);
});

test('cancel from WAITING_FOR_CARD', () => {
  const session = createPaymentSession();
  session.send('SELECT_SERVICE');
  session.send('SELECT_CARD_PAYMENT');
  session.send('CONNECT_POS');
  session.send('POS_CONNECTED');
  session.send('START_PAYMENT');
  session.send('CANCEL');
  assert.equal(session.getState(), STATES.PAYMENT_CANCELLED);
});

test('timeout from PROCESSING_PAYMENT', () => {
  const session = createPaymentSession();
  session.send('SELECT_SERVICE');
  session.send('SELECT_CARD_PAYMENT');
  session.send('CONNECT_POS');
  session.send('POS_CONNECTED');
  session.send('START_PAYMENT');
  session.send('CARD_DETECTED');
  session.send('TIMEOUT');
  assert.equal(session.getState(), STATES.PAYMENT_TIMEOUT);
});

test('invalid transition throws instead of silently moving state', () => {
  assert.throws(() => transition(STATES.IDLE, 'SUCCESS'));
  assert.throws(() => transition(STATES.WAITING_FOR_CARD, 'SELECT_SERVICE'));
});

test('PAYMENT_SUCCESS -> START_CYCLE -> CYCLE_IN_PROGRESS -> CYCLE_COMPLETE -> IDLE, and the cycle cannot be started twice', () => {
  const session = createPaymentSession();
  session.send('SELECT_SERVICE');
  session.send('SELECT_CARD_PAYMENT');
  session.send('CONNECT_POS');
  session.send('POS_CONNECTED');
  session.send('START_PAYMENT');
  session.send('CARD_DETECTED');
  session.send('SUCCESS');
  assert.equal(session.canStartCycle(), true);

  session.send('START_CYCLE');
  assert.equal(session.getState(), STATES.CYCLE_IN_PROGRESS);
  // The whole point: once consumed, the same payment can never authorize
  // a second cycle — canStartCycle() is a pure function of the state, and
  // this state is no longer PAYMENT_SUCCESS.
  assert.equal(session.canStartCycle(), false);
  assert.throws(() => transition(STATES.CYCLE_IN_PROGRESS, 'START_CYCLE'));

  session.send('CYCLE_COMPLETE');
  assert.equal(session.getState(), STATES.IDLE);
  assert.equal(session.canStartCycle(), false);
});

test('RESET is available from CYCLE_IN_PROGRESS', () => {
  assert.equal(transition(STATES.CYCLE_IN_PROGRESS, 'RESET'), STATES.IDLE);
});

test('a terminal error/decline/cancel/timeout state can RESET back to IDLE', () => {
  for (const state of [
    STATES.PAYMENT_DECLINED,
    STATES.PAYMENT_CANCELLED,
    STATES.PAYMENT_ERROR,
    STATES.PAYMENT_TIMEOUT,
  ]) {
    assert.equal(transition(state, 'RESET'), STATES.IDLE);
  }
});

for (const state of Object.values(STATES)) {
  test(`canStartCycle(${state}) is ${state === STATES.PAYMENT_SUCCESS}`, () => {
    assert.equal(canStartCycle(state), state === STATES.PAYMENT_SUCCESS);
  });
}
