import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCuboQRProvider, CuboQRProviderNotImplementedError } from '../src/payment/cuboQRProvider.js';
import { createPaymentProvider } from '../src/payment/paymentProvider.js';

test('CuboQRProvider is inert: calling it always throws and performs no work', () => {
  assert.throws(() => createCuboQRProvider(), CuboQRProviderNotImplementedError);
});

test('createPaymentProvider({type:"qr"}) also throws — QR is not reachable as a working provider yet', () => {
  assert.throws(() => createPaymentProvider({ type: 'qr' }), CuboQRProviderNotImplementedError);
});

test('createPaymentProvider({type:"card"}) returns a working provider', () => {
  const provider = createPaymentProvider({
    type: 'card',
    mode: 'mock',
    machineConfig: { machineId: 'HX02-TEST', currency: 'GTQ' },
  });
  assert.equal(provider.providerType, 'card');
  assert.equal(typeof provider.createPayment, 'function');
});

test('createPaymentProvider rejects unknown types', () => {
  assert.throws(() => createPaymentProvider({ type: 'bogus' }), /Unknown PaymentProvider type/);
});
