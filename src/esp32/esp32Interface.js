// Conceptual ESP32 interface for HX02 — Phase 1 stub only.
//
// Per the lab brief: do NOT assume GPIO pins, IP address, transport
// protocol, endpoint shape, WebSocket, Bluetooth or MQTT for HX02's ESP32.
// HX01's firmware/protocol must not be touched or copied. The real HX02
// protocol is defined in a later phase, after this Cubo payment test passes
// and the existing HX02 hardware (if any) has been inspected.
//
// What this module DOES do: enforce, at the boundary between "payment" and
// "machine control", the one non-negotiable rule from the spec — a cycle
// may only be requested when the payment state machine reports
// PAYMENT_SUCCESS. It intentionally has no working transport; calling it
// always throws, so it cannot be mistaken for a real integration.

import { canStartCycle } from '../payment/paymentStateMachine.js';
import { log } from '../logger.js';

export class Esp32NotImplementedError extends Error {}

/**
 * @param {{machineId: string, state: string, service?: {label?: string}}} params
 */
export function requestCycleStart({ machineId, state, service }) {
  if (!canStartCycle(state)) {
    throw new Error(
      `Refused to request cycle start: payment state is "${state}", only PAYMENT_SUCCESS is allowed.`
    );
  }

  log(machineId, 'Cycle start requested (ESP32 protocol not yet implemented)', {
    service: service?.label,
  });

  throw new Esp32NotImplementedError(
    'ESP32 protocol for HX02 is not defined yet. See CUBO-INTEGRATION.md (ESP32 section) ' +
      'and README.md before implementing a real transport.'
  );
}
