import { createMockCuboAdapter } from './mockCuboAdapter.js';
import { createWebSdkCuboAdapter } from './webSdkCuboAdapter.js';
import { CUBO_EVENTS, CUBO_STATUS_VALUES, CUBO_ERROR_TYPES } from './cuboEvents.js';

export { CUBO_EVENTS, CUBO_STATUS_VALUES, CUBO_ERROR_TYPES };

// ISO 4217 numeric currency codes, as used by startPayment()'s
// `currencyCode` parameter (confirmed shape, see webSdkCuboAdapter.js).
export const CUBO_CURRENCY_ISO4217 = Object.freeze({
  GTQ: '0320',
  USD: '0840',
});

/**
 * @param {{mode: 'mock'|'web-sdk', machineConfig: object, apiKey?: string}} params
 */
export function createCuboAdapter({ mode, machineConfig, apiKey }) {
  if (mode === 'mock') return createMockCuboAdapter({ machineConfig });
  if (mode === 'web-sdk') return createWebSdkCuboAdapter({ machineConfig, apiKey });
  throw new Error(`Unknown Cubo adapter mode: "${mode}". Use "mock" or "web-sdk".`);
}
