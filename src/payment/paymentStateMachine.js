// Payment state machine for the FreshTouch HX02 Cubo lab.
//
// This is the single safety-critical module in the lab: `canStartCycle()`
// is the ONLY function anywhere in this codebase allowed to say a machine
// cycle may begin, and it says yes for exactly one state: PAYMENT_SUCCESS.
// Every other state — including ones that sound "close enough" (card
// detected, processing, POS connected) — must return false.

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  SERVICE_SELECTED: 'SERVICE_SELECTED',
  PAYMENT_METHOD_SELECTED: 'PAYMENT_METHOD_SELECTED',
  CONNECTING_POS: 'CONNECTING_POS',
  POS_CONNECTED: 'POS_CONNECTED',
  WAITING_FOR_CARD: 'WAITING_FOR_CARD',
  PROCESSING_PAYMENT: 'PROCESSING_PAYMENT',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  PAYMENT_TIMEOUT: 'PAYMENT_TIMEOUT',
  // Entered the instant a cycle is authorized and requested — see
  // requestCycle() in cuboCardProvider.js. This is what closes the "one
  // payment, one cycle" gap: canStartCycle() is a pure function of the
  // CURRENT state, so once this fires, the state is no longer
  // PAYMENT_SUCCESS and a second cycle request for the same payment is
  // refused by the same guard, with no separate "already used" flag.
  CYCLE_IN_PROGRESS: 'CYCLE_IN_PROGRESS',
});

const TERMINAL_STATES = new Set([
  STATES.PAYMENT_SUCCESS,
  STATES.PAYMENT_DECLINED,
  STATES.PAYMENT_CANCELLED,
  STATES.PAYMENT_ERROR,
  STATES.PAYMENT_TIMEOUT,
]);

// Explicit transition table. There is no wildcard/default transition —
// an event not listed for the current state throws instead of silently
// moving somewhere unexpected.
const TRANSITIONS = {
  [STATES.IDLE]: {
    SELECT_SERVICE: STATES.SERVICE_SELECTED,
  },
  [STATES.SERVICE_SELECTED]: {
    SELECT_CARD_PAYMENT: STATES.PAYMENT_METHOD_SELECTED,
    RESET: STATES.IDLE,
  },
  [STATES.PAYMENT_METHOD_SELECTED]: {
    CONNECT_POS: STATES.CONNECTING_POS,
    RESET: STATES.IDLE,
  },
  [STATES.CONNECTING_POS]: {
    POS_CONNECTED: STATES.POS_CONNECTED,
    POS_CONNECTION_FAILED: STATES.PAYMENT_ERROR,
    RESET: STATES.IDLE,
  },
  [STATES.POS_CONNECTED]: {
    START_PAYMENT: STATES.WAITING_FOR_CARD,
    POS_DISCONNECTED: STATES.PAYMENT_ERROR,
    RESET: STATES.IDLE,
  },
  [STATES.WAITING_FOR_CARD]: {
    CARD_DETECTED: STATES.PROCESSING_PAYMENT,
    CANCEL: STATES.PAYMENT_CANCELLED,
    TIMEOUT: STATES.PAYMENT_TIMEOUT,
    ERROR: STATES.PAYMENT_ERROR,
  },
  [STATES.PROCESSING_PAYMENT]: {
    SUCCESS: STATES.PAYMENT_SUCCESS,
    DECLINED: STATES.PAYMENT_DECLINED,
    CANCEL: STATES.PAYMENT_CANCELLED,
    TIMEOUT: STATES.PAYMENT_TIMEOUT,
    ERROR: STATES.PAYMENT_ERROR,
  },
  [STATES.PAYMENT_SUCCESS]: {
    RESET: STATES.IDLE,
    START_CYCLE: STATES.CYCLE_IN_PROGRESS,
  },
  [STATES.CYCLE_IN_PROGRESS]: {
    // CYCLE_COMPLETE is sent once the physical cycle is confirmed finished
    // — today that's simulated by the lab immediately after the ESP32
    // stub throws "not implemented" (see lab.js); a real ESP32 integration
    // must only send it once hardware actually confirms completion.
    CYCLE_COMPLETE: STATES.IDLE,
    RESET: STATES.IDLE,
  },
  [STATES.PAYMENT_DECLINED]: {
    RESET: STATES.IDLE,
    RETRY: STATES.PAYMENT_METHOD_SELECTED,
  },
  [STATES.PAYMENT_CANCELLED]: {
    RESET: STATES.IDLE,
    RETRY: STATES.PAYMENT_METHOD_SELECTED,
  },
  [STATES.PAYMENT_ERROR]: {
    RESET: STATES.IDLE,
    RETRY: STATES.PAYMENT_METHOD_SELECTED,
  },
  [STATES.PAYMENT_TIMEOUT]: {
    RESET: STATES.IDLE,
    RETRY: STATES.PAYMENT_METHOD_SELECTED,
  },
};

export function transition(currentState, event) {
  const stateTransitions = TRANSITIONS[currentState];
  if (!stateTransitions || !(event in stateTransitions)) {
    throw new Error(`Invalid transition: event "${event}" from state "${currentState}"`);
  }
  return stateTransitions[event];
}

export function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

// The single authorization check for starting a machine cycle.
export function canStartCycle(state) {
  return state === STATES.PAYMENT_SUCCESS;
}

export function createPaymentSession() {
  let state = STATES.IDLE;
  const history = [state];
  return {
    getState: () => state,
    send(event) {
      state = transition(state, event);
      history.push(state);
      return state;
    },
    getHistory: () => [...history],
    canStartCycle: () => canStartCycle(state),
  };
}
