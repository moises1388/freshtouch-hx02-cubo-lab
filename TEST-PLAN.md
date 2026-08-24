# Test Plan

## Automated (run: `npm test`, no dependencies, 53 tests today)

### Payment state machine — `tests/paymentStateMachine.test.js`
- Happy path IDLE → ... → PAYMENT_SUCCESS reaches `canStartCycle() === true`.
- Declined and cancelled paths reach their respective terminal states and
  never `PAYMENT_SUCCESS`.
- Invalid transitions throw instead of silently changing state.
- Terminal non-success states can `RESET` back to `IDLE`.
- `canStartCycle(state)` is exhaustively checked against every state in the
  machine — true for exactly one (`PAYMENT_SUCCESS`), false for all others.

### Security rule — `tests/security.test.js`
Directly tests the brief's non-negotiable rule. `requestCycleStart()` is
called once per state and must refuse for every one of:

`IDLE`, `SERVICE_SELECTED`, `PAYMENT_METHOD_SELECTED`, `CONNECTING_POS`,
`POS_CONNECTED`, `WAITING_FOR_CARD`, `PROCESSING_PAYMENT`,
`PAYMENT_DECLINED`, `PAYMENT_CANCELLED`, `PAYMENT_ERROR`,
`PAYMENT_TIMEOUT`

and only pass the guard (reaching the "ESP32 not implemented yet" stub, not
a refusal) for `PAYMENT_SUCCESS`.

### Mock Cubo adapter — `tests/mockCuboAdapter.test.js`
POS lifecycle:
- `connect()` emits `connected` with `{ deviceName }`, flips
  `isConnected()` to true.
- `disconnect()` emits `disconnected` (no payload), flips it back to false.
- `startPayment()` before `connect()` rejects (POS not connected / not
  found case).

Payment outcomes — one test per outcome, asserting the emitted
`transactionResult` matches the real, confirmed shape
(`{ success, data?, pending?, message?, error?: {type, message} }`) for:
`SUCCESS`, `DECLINED` (`error.type === 'transaction_declined'`), `PENDING`
(`pending: true`, no `error`), `ERROR` (`error.type === 'sdk_error'`).
`DECLINED`/`ERROR` also emit a standalone `error` event with the same
`{ type, message }`.

Data hygiene:
- A `SUCCESS` result's keys never include anything matching
  `card|pan|cvv|pin`.

### CuboCardProvider — `tests/cuboCardProvider.test.js`
- Full happy path through `PaymentProvider`: `selectService` →
  `connectPos` → `createPayment` → `PAYMENT_SUCCESS` → `canStartCycle()`
  true → `requestCycle()` passes the guard.
- `DECLINED` / `ERROR`: `canStartCycle()` stays false, `requestCycle()`
  refuses.
- **`PENDING`: does not transition the session at all, `canStartCycle()`
  stays false, `requestCycle()` refuses, and nothing is retried
  automatically** — this is the case the real SDK's own docs call out as
  the one most likely to cause a double charge if handled wrong.
- Calling `connectPos()`/`createPayment()` out of order throws.
- Disconnecting mid-flow lands in `PAYMENT_ERROR`, not authorized.
- Local `cancelPayment()` mid-flow lands in `PAYMENT_CANCELLED`, not
  authorized; a late result arriving after cancellation is correctly
  rejected by the state machine (not silently accepted).
- `onResult()` unsubscribe stops further notifications.

### CuboQRProvider — `tests/cuboQRProvider.test.js`
- Confirms the QR provider is inert: calling it (directly or via
  `createPaymentProvider({type:'qr'})`) always throws and performs no
  work — no network calls, no state changes.

## Manual — lab UI (`lab/lab.html`, simulated mode, no hardware needed)

Verified in a real headless-Chromium run (Playwright), not just by
inspection — see git history for the exact scripted runs.

- [x] Page loads over `http://localhost:<port>/lab/lab.html` with no
      console errors.
- [x] Machine config for HX02 loads; BASIC/PREMIUM buttons show the
      configured prices.
- [x] Selecting a service highlights it and advances the payment status
      display.
- [x] "CONNECT POS" transitions POS status to Connected and payment status
      to `POS_CONNECTED`.
- [x] "TEST PAYMENT" with simulated outcome `SUCCESS` shows `SUCCESS`,
      a transaction ID (from `result.data`, mock-only), and "Cycle
      authorization: AUTHORIZED"; the log panel shows the ESP32 guard
      passing (not-implemented stub).
- [x] "TEST PAYMENT" with each of `DECLINED` / `PENDING` / `ERROR` shows
      the matching status/message and "Cycle authorization: NOT
      AUTHORIZED" — never AUTHORIZED, never the not-implemented stub log
      line.
- [x] "DISCONNECT POS" mid-flow (after connecting, before payment) lands
      on `PAYMENT_ERROR`, NOT AUTHORIZED.
- [x] Switching to "Real Cubo Web SDK" mode without the script loaded
      shows "script not loaded yet", disables CONNECT POS, and does not
      crash; switching back to mock fully recovers.
- [x] "RESET" clears the result panel and returns payment status to
      `IDLE`.
- [x] No card number, CVV, PIN, or API key ever appears in the on-screen
      log panel or the browser console.

## Manual — real hardware (cannot be performed from this environment; checklist for whoever has the tablet + POS + credentials)

POS:
- [ ] POS powered off — lab reports a connection failure, not a false
      "connected".
- [ ] Tablet Bluetooth off — `Bluetooth` status shows OFF/unavailable
      before attempting connect.
- [x] **POS powered on, in range, Bluetooth on — POS is found and reaches
      `CONNECTED`.** Confirmed on the real HX02 tablet + physical QPOS
      Cute (S/N `29600100122031610810`): Chrome's native Bluetooth picker
      showed the device, pairing completed, `pos-status: Connected`,
      `r-connection: CONNECTED`. Not yet confirmed: the real `deviceName`
      string, since the lab UI doesn't currently display it anywhere (the
      `connected` payload is received but discarded — see
      `cuboCardProvider.js`'s CONNECTED handler). Worth wiring up as a
      small follow-up, not required for the next step.
- [ ] POS out of range / not discoverable — connect attempt fails
      cleanly, state machine reaches `PAYMENT_ERROR`, no crash.
- [ ] Disconnect mid-session (POS powered off after connecting) —
      `disconnected` event observed, UI reflects it.

Payment (real card, `SANDBOX` environment, small test amount):
- [ ] Successful tap/insert/swipe → `transactionResult.success === true`
      → screen shows whatever `result.data` actually contains (record the
      real field names here and update `CUBO-INTEGRATION.md`'s UNVERIFIED
      section and `mockCuboAdapter.js`'s placeholder once observed).
- [ ] Declined card → `error.type === 'transaction_declined'`, no
      cycle-start attempt.
- [ ] Ambiguous/network failure during payment → observe whether
      `pending: true` actually arrives as documented, and what
      `result.message` says — no cycle-start attempt, no automatic retry.
- [ ] Unsupported card / other SDK error → surfaces without crashing the
      page.
- [ ] Confirm whether `cancelCurrentTransaction()` produces a
      `transactionResult`, an `error`, both, or neither — currently
      UNVERIFIED and not wired into `CuboCardProvider.cancelPayment()`.

Before this checklist can run, generate a real sandbox API key in Cubo
Admin Sandbox and confirm the current SDK script version (see
`CUBO-INTEGRATION.md`) — the SDK identity and shapes are now confirmed
against Cubo's official demo repo, but none of it has been run against
real hardware yet.
