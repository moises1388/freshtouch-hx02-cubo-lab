// Thin wrapper around the real Cubo Web SDK.
//
// CONFIRMED — sourced directly from Cubo's own official demo repository:
// github.com/Cubo-App/cubo-pos-sdk-web-demo (cloned and read in this
// session: README.md, demo.html, src/app.js, llms.txt, and
// .claude/skills/cubo-sdk-help/references/*.md). This is real, working
// example code from Cubo, not search-engine summaries or guesses. See
// CUBO-INTEGRATION.md for full provenance and any remaining open items.
//
//   - Global class name is CuboPagoSDK (window.CuboPagoSDK) — NOT
//     "CuboSDK" as earlier, unverified guesses in this file used to say.
//   - Script tag: <script src="https://sdk.cubopago.com/pos/vX.Y.Z/cubo-pos-sdk-web.js">
//     (the demo repo's own demo.html currently pins v1.11.0; its README
//     says v1.10.0 and its Claude skill says v1.1.1 — these are stale
//     relative to demo.html, which is live, runnable code, so it's the
//     more trustworthy of the three. Confirm the current version when
//     wiring the real tag in — see CUBO-INTEGRATION.md.)
//   - npm package: cubo-pos-sdk-web.
//   - Init: new CuboPagoSDK({ apiKey, environment, enableMsi?, msiModal?,
//     hasPrinter? }). apiKey and environment are required (throws
//     synchronously if missing). environment is one of the literal
//     strings 'SANDBOX' | 'PRODUCTION' (also documented in two places as
//     accepting 'STG' | 'DEV') — uppercase, unlike this lab's own
//     machine.config.json convention of lowercase 'sandbox'/'production'.
//   - Works only with the Cubo QPOS Cute terminal model, over Web
//     Bluetooth. Requires a secure context (HTTPS, or http://localhost
//     for development) and Bluetooth enabled on the device.
//   - Supported browsers: Chrome 56+ (Desktop/Android), Edge 79+
//     (Desktop), Opera 43+ (Desktop/Android). Not Safari, not Firefox —
//     neither on desktop nor mobile.
//   - Methods: connect(): Promise<string> (resolves with the connected
//     device's name; requires a user gesture, i.e. must be called from a
//     click handler), disconnect(): void, startPayment(params): Promise<void>
//     (throws synchronously on validation errors — not connected, bad
//     amount/currency; the actual result arrives later via the
//     'transactionResult' event), cancelCurrentTransaction(): boolean
//     (aborts the in-flight HTTP call — wired into CuboCardProvider's
//     cancelPayment()), getDeviceInfo(), getPosId(), getInstallments(),
//     getInstallmentCalculation() (MSI-only, unused by HX02), on(), off(),
//     removeAllListeners(). Public properties: isConnected (boolean),
//     device (BluetoothDevice | null).
//   - startPayment({ amount, currencyCode, currencySymbol,
//     monthlyInstallmentId? }): amount is a STRING in cents (e.g. "1250"
//     for Q12.50/$12.50); currencyCode is the 4-digit ISO 4217 numeric
//     code as a string ("0320" GTQ, "0840" USD, "0484" MXN);
//     currencySymbol is a display string ("Q", "$"); monthlyInstallmentId
//     is MSI-only, unused by HX02.
//   - Events (see cuboEvents.js for the exhaustive name lists):
//     'connected' ({ deviceName }), 'disconnected' (no payload), 'status'
//     (payload IS the status string itself — not a closed enum, recovery
//     flows emit free-form Spanish progress messages too), 'loading'
//     (boolean), 'transactionResult' (see the payload shape documented in
//     cuboCardProvider.js — this is the one place that shape is
//     interpreted), 'error' ({ type, message }), 'installmentsLoaded'
//     (MSI-only, unused by HX02).
//   - The SDK includes its own automatic payment-recovery mechanism
//     (idempotency key + progressive status polling) for ambiguous
//     network failures. Do not build a second retry layer on top of it —
//     see cuboCardProvider.js's handling of transactionResult.pending.
//
// STILL UNVERIFIED (not found in the demo repo, not guessed here):
//   - The exact shape of transactionResult.data on success — the demo
//     repo describes it only as "the full API response" without
//     documenting its fields.
//   - Whether/how this SDK relates to the api-payment-sandbox.cubopago.com
//     REST endpoint Cubo separately gave this project — nothing in the
//     demo repo (docs, demo app, or its Claude skill) mentions that
//     hostname. The SDK appears to be a self-contained script served from
//     sdk.cubopago.com that manages its own backend communication; this
//     project's own code has never needed to reference that REST endpoint
//     directly, and nothing here assumes it does.
//   - Any account-specific setup needed in Cubo Admin Sandbox beyond
//     generating the API key (e.g. registering the QPOS Cute's serial).

import { log, maskSecret } from '../logger.js';
import { CUBO_EVENTS, CUBO_STATUS_VALUES, CUBO_ERROR_TYPES } from './cuboEvents.js';

// Re-exported for convenience so callers of this adapter don't need a
// separate import to know what event/status/error names to expect.
export { CUBO_EVENTS, CUBO_STATUS_VALUES, CUBO_ERROR_TYPES };

export function createWebSdkCuboAdapter({ machineConfig, apiKey }) {
  if (typeof window === 'undefined' || !window.CuboPagoSDK) {
    throw new Error(
      'window.CuboPagoSDK is not present. Load the official Cubo Web SDK <script> tag before using this adapter (see CUBO-INTEGRATION.md).'
    );
  }
  if (!apiKey) {
    throw new Error('Missing Cubo API key. It must never be hardcoded or committed to the repo.');
  }

  // machine.config.json uses lowercase ('sandbox'/'production') by this
  // lab's own convention; the real SDK requires uppercase literal strings.
  const environment = (machineConfig.cuboEnvironment || 'sandbox').toUpperCase();

  log(machineConfig.machineId, 'Initializing Cubo Web SDK', {
    environment,
    apiKey: maskSecret(apiKey),
  });

  const sdk = new window.CuboPagoSDK({ apiKey, environment });

  function on(event, handler) {
    sdk.on(event, handler);
    return () => sdk.off?.(event, handler);
  }

  async function connect() {
    log(machineConfig.machineId, 'POS connecting');
    return sdk.connect();
  }

  async function disconnect() {
    log(machineConfig.machineId, 'POS disconnecting');
    return sdk.disconnect();
  }

  async function startPayment({ amount, currencyCode, currencySymbol }) {
    log(machineConfig.machineId, 'Payment started', { amount, currencyCode, currencySymbol });
    return sdk.startPayment({ amount, currencyCode, currencySymbol });
  }

  // cancelCurrentTransaction() aborts the in-flight HTTP call — confirmed
  // real method, see the header comment. Whether it also produces a
  // transactionResult/error afterward is UNVERIFIED; CuboCardProvider
  // doesn't wait on that, it transitions its own local state immediately.
  function cancelCurrentTransaction() {
    return sdk.cancelCurrentTransaction();
  }

  return {
    connect,
    disconnect,
    startPayment,
    on,
    cancelCurrentTransaction,
    isConnected: () => sdk.isConnected,
  };
}
