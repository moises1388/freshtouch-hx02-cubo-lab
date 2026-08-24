// CuboQRProvider — PLANNED, NOT IMPLEMENTED.
//
// This file exists only to record the future shape of the PaymentProvider
// interface for the QR payment method that already runs in production on
// HX01. It must not be wired into anything, must not perform network
// calls, and must not be reachable as a working payment method yet.
// createPaymentProvider({type:'qr'}) routes here only to fail loudly, on
// purpose — see paymentProvider.js.
//
// Why base this on HX01 findings rather than guessing: unlike the card
// flow (still partly UNVERIFIED against Cubo's own docs), HX01's QR flow
// is real, running code that was read-only audited directly, including
// its live Make.com scenarios. The shape below reflects that audit, not
// invention:
//   - Creating a payment is a webhook call to a Make.com scenario, which
//     calls Cubo's real HTTP API (POST .../links/one-use) and returns
//     {paymentUrl, paymentIntentToken}. FreshTouch renders paymentUrl as a
//     QR itself, via a third-party QR image service — Cubo does not hand
//     back a QR image directly.
//   - Confirmation is client-side polling of a second Make webhook, which
//     answers {confirmado: true|false} by searching a Make Data Store that
//     a separate Cubo -> Make callback populates.
//   - HX01 has a "confirm manually" fallback button that marks the
//     payment as successful WITHOUT any provider confirmation. The
//     machine owner has explicitly ruled this pattern out for the new
//     architecture (see the hydrox-payment-architecture Skill's security
//     rules) — CuboQRProvider must never grow an equivalent shortcut.
//
// None of HX01's actual webhook URLs, tokens, or the Cubo API key are
// reproduced here — those belong to HX01's Make account and stay there.
// A real CuboQRProvider for HX02 would need its own Make scenario (or a
// direct integration), configured the same way CuboCardProvider's API key
// already is: through machines/<ID>/machine.config.json (non-secret) and
// machines/<ID>/secrets.local.json (gitignored).

export class CuboQRProviderNotImplementedError extends Error {}

export function createCuboQRProvider() {
  throw new CuboQRProviderNotImplementedError(
    'CuboQRProvider is not implemented. HX02 is validating CuboCardProvider first; ' +
      'QR stays QR-on-HX01-only until the machine owner asks for it here.'
  );
}
