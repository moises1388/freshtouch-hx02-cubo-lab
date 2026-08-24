import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCuboAdapter } from '../src/cubo/mockCuboAdapter.js';
import { CUBO_ERROR_TYPES } from '../src/cubo/cuboEvents.js';

const machineConfig = { machineId: 'HX02-TEST', cuboPosId: 'POS-TEST' };

test('connect() emits connected ({ deviceName }) and flips isConnected', async () => {
  const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
  let payload;
  adapter.on('connected', (p) => (payload = p));
  await adapter.connect();
  assert.ok(payload?.deviceName);
  assert.equal(adapter.isConnected(), true);
});

test('disconnect() emits disconnected and flips isConnected back', async () => {
  const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
  await adapter.connect();
  let fired = false;
  adapter.on('disconnected', () => (fired = true));
  await adapter.disconnect();
  assert.equal(fired, true);
  assert.equal(adapter.isConnected(), false);
});

test('startPayment before connect throws (POS not found / not connected)', async () => {
  const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
  await assert.rejects(() =>
    adapter.startPayment({ amount: '2000', currencyCode: '0320', currencySymbol: 'Q' })
  );
});

// Confirmed real shape (see cuboEvents.js / CUBO-INTEGRATION.md):
// { success: boolean, data?, pending?: boolean, message?: string, error?: {type, message} }
const outcomes = ['SUCCESS', 'DECLINED', 'PENDING', 'ERROR'];
for (const outcome of outcomes) {
  test(`startPayment outcome=${outcome} emits a matching transactionResult`, async () => {
    const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
    await adapter.connect();
    const result = await new Promise((resolve) => {
      adapter.on('transactionResult', resolve);
      adapter.startPayment({ amount: '2000', currencyCode: '0320', currencySymbol: 'Q', outcome });
    });

    if (outcome === 'SUCCESS') {
      assert.equal(result.success, true);
      assert.ok(result.data);
    } else if (outcome === 'PENDING') {
      assert.equal(result.success, false);
      assert.equal(result.pending, true);
      assert.ok(result.message);
      assert.equal(result.error, undefined);
    } else if (outcome === 'DECLINED') {
      assert.equal(result.success, false);
      assert.equal(result.error.type, CUBO_ERROR_TYPES.TRANSACTION_DECLINED);
      assert.ok(result.error.message);
    } else {
      // ERROR (generic sdk_error)
      assert.equal(result.success, false);
      assert.equal(result.error.type, CUBO_ERROR_TYPES.SDK_ERROR);
      assert.ok(result.error.message);
    }
  });
}

test('DECLINED and ERROR also emit a standalone error event with the same { type, message }', async () => {
  for (const outcome of ['DECLINED', 'ERROR']) {
    const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
    await adapter.connect();
    let errorPayload;
    adapter.on('error', (e) => (errorPayload = e));
    const result = await new Promise((resolve) => {
      adapter.on('transactionResult', resolve);
      adapter.startPayment({ amount: '2000', currencyCode: '0320', currencySymbol: 'Q', outcome });
    });
    assert.deepEqual(errorPayload, result.error);
  }
});

test('SUCCESS result never includes card number, cvv or pin fields', async () => {
  const adapter = createMockCuboAdapter({ machineConfig, simulatedLatencyMs: 1 });
  await adapter.connect();
  const result = await new Promise((resolve) => {
    adapter.on('transactionResult', resolve);
    adapter.startPayment({ amount: '2000', currencyCode: '0320', currencySymbol: 'Q', outcome: 'SUCCESS' });
  });
  const keys = JSON.stringify(result).toLowerCase();
  assert.doesNotMatch(keys, /card|pan|cvv|pin/);
});
