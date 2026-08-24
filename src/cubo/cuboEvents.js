// Event, status, and error-type names CONFIRMED against Cubo's own official
// demo repository: github.com/Cubo-App/cubo-pos-sdk-web-demo (README.md,
// llms.txt, and .claude/skills/cubo-sdk-help/references/*.md), cloned and
// read directly in this session — not search-engine summaries, not
// guesses. See CUBO-INTEGRATION.md for the full provenance and any
// remaining open questions.
//
// Two of the demo repo's own docs (llms.txt and the cubo-sdk-help skill's
// inline comments) abbreviate the payment status list as 'processing'
// and omit 'transaction_terminated'; README.md's full status table (the
// most detailed, structured source) uses 'processing_payment' and
// includes 'transaction_terminated'. This file follows README.md as the
// more authoritative source — see CUBO-INTEGRATION.md for the note on
// that discrepancy.

export const CUBO_EVENTS = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  LOADING: 'loading',
  TRANSACTION_RESULT: 'transactionResult',
  ERROR: 'error',
  STATUS: 'status',
  // Only fires when the SDK is configured with enableMsi:true and
  // msiModal:false — HX02 doesn't use MSI (flat BASIC/PREMIUM pricing),
  // listed here for completeness/reference only.
  INSTALLMENTS_LOADED: 'installmentsLoaded',
});

// Values carried by the 'status' event's payload (the event payload IS the
// string itself, confirmed — not wrapped in an object). Status is NOT a
// closed enum: during automatic payment recovery the SDK also emits
// free-form Spanish progress messages (e.g. "Estamos confirmando tu pago
// con el banco...") that aren't in this list — code reading `status` must
// tolerate values outside this set rather than treating it as exhaustive.
export const CUBO_STATUS_VALUES = Object.freeze({
  // Connection
  SEARCHING: 'searching',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  // Device verification / EMV configuration
  VERIFYING_POS: 'verifying_pos',
  PREPARING_POS_CONFIGURATION: 'preparing_pos_configuration',
  CONFIGURING_POS: 'configuring_pos',
  VERIFICATION_FAILED: 'verification_failed',
  CONFIGURING_FAILED: 'configuring_failed',
  // Payment
  WAITING_FOR_CARD: 'waiting_for_card',
  PROCESSING_PAYMENT: 'processing_payment',
  PAYMENT_SUCCESS: 'payment_success',
  PAYMENT_FAILED: 'payment_failed',
  PAYMENT_PENDING: 'payment_pending',
  TRANSACTION_TERMINATED: 'transaction_terminated',
});

// error event payload is { type, message } — these are the confirmed
// `type` values.
export const CUBO_ERROR_TYPES = Object.freeze({
  NOT_CONNECTED: 'not_connected',
  CONNECTION_FAILED: 'connection_failed',
  INVALID_AMOUNT: 'invalid_amount',
  INVALID_CURRENCY_CODE: 'invalid_currency_code',
  INVALID_CURRENCY_SYMBOL: 'invalid_currency_symbol',
  TRANSACTION_DECLINED: 'transaction_declined',
  TRANSACTION_NOT_FOUND: 'transaction_not_found',
  RECOVERY_IN_PROGRESS: 'recovery_in_progress',
  SDK_ERROR: 'sdk_error',
});
