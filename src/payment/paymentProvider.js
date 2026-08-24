// PaymentProvider — the common contract every Hydrox payment method
// implements, so FreshTouch (and later HX03/HX04/...) can authorize a
// machine cycle the same way regardless of how the customer paid.
//
// This module does not enforce the interface with a class hierarchy — with
// exactly one working implementation today (card) and one deliberately
// inert stub (QR), a runtime-checked abstract base would be ceremony
// without payoff. It documents the shape and provides the single factory
// that picks an implementation, so callers depend on one entry point
// instead of importing CuboCardProvider/CuboQRProvider directly.
//
// Conceptual contract (method names proposed by the machine owner, adopted
// here after checking they fit the state machine/adapter layers already
// built in this lab):
//
//   provider.selectService(service)      -> fix which priced service is being paid for
//   provider.connectPos()                -> establish the POS/session link
//   provider.disconnectPos()             -> release it
//   provider.createPayment()             -> begin a payment attempt for the selected service
//   provider.cancelPayment()             -> local, best-effort cancel (see caveats per provider)
//   provider.getStatus()                 -> current STATES.* value
//   provider.canStartCycle()             -> true ONLY when getStatus() === 'PAYMENT_SUCCESS'
//   provider.requestCycle()              -> ask to start the machine cycle (re-checks canStartCycle itself)
//   provider.onResult(handler)           -> subscribe to every state change, not just the final one
//
// Deviation from the original "waitForResult()" proposal: a single
// awaited promise would collapse WAITING_FOR_CARD/PROCESSING_PAYMENT into
// invisible intermediate steps. The security tests need to observe each
// state on the way to (or away from) PAYMENT_SUCCESS, so onResult is an
// event subscription instead — the same shape the Cubo adapters already
// expose via on().

import { STATES, canStartCycle, isTerminal } from './paymentStateMachine.js';
import { createCuboCardProvider } from './cuboCardProvider.js';
import { createCuboQRProvider } from './cuboQRProvider.js';

export { STATES, canStartCycle, isTerminal };

/**
 * @param {{type: 'card'|'qr', mode?: 'mock'|'web-sdk', machineConfig?: object, apiKey?: string}} params
 */
export function createPaymentProvider({ type, ...rest }) {
  if (type === 'card') return createCuboCardProvider(rest);
  if (type === 'qr') return createCuboQRProvider(rest);
  throw new Error(`Unknown PaymentProvider type: "${type}". Only "card" is implemented today.`);
}
