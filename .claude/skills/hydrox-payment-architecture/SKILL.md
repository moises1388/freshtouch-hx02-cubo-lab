---
name: hydrox-payment-architecture
description: Use this skill when designing, implementing, reviewing, or extending payment integrations for Hydrox FreshTouch machines (HX01, HX02, HX03, ...) — the PaymentProvider architecture (CuboCardProvider, CuboQRProvider), the payment state machine and its security rules, the relationship between a confirmed payment and ESP32 machine authorization, per-machine configuration, sandbox/mock testing, and the process for adding a new payment method or a new machine to the fleet. Also use it when reviewing any code that decides whether a Hydrox machine may start a cycle.
---

# Hydrox Payment Architecture

## What this is

A process guide for how Hydrox machines (FreshTouch and whatever comes
after it) decide "did the customer actually pay, and can the machine start
now." It exists because HX01 (QR via Make + Cubo API) and HX02 (card via
Cubo Web SDK + Bluetooth) are architecturally very different on the
payment-collection side, but must agree on one thing: **only a confirmed
payment may authorize a machine cycle.** This skill documents the shared
layer that makes that agreement enforceable in code, not just in
intention, and the process for extending it to new payment methods and new
machines without re-deriving the safety rules each time.

This skill teaches a *process*, not a fixed API. The method names below
(`createPayment`, `canStartCycle`, ...) are the ones currently implemented
in `freshtouch-hx02-cubo-lab/`; treat them as the reference implementation
of the pattern, not as a contract frozen for all time.

## Isolation rule — read this first

HX01 (`moises1388/freshtouch-hx01`, root of this repo) is in production and
is a reference for how things currently work, never a target for changes
made in service of this architecture. Every file this skill's pattern
touches lives under `freshtouch-hx02-cubo-lab/` (or the equivalent
per-machine lab for HX03/HX04/...). If implementing this architecture ever
seems to require changing HX01 — its `app.js`, `config.js`, its Make
scenarios, its Cubo account, or its ESP32 — stop and get explicit
authorization first. That has held for every phase of this project so far
and does not change.

## The architecture

```
                     Hydrox Payment
                          │
              ┌───────────┼───────────┐
              │           │           │
             QR         Tarjeta     (future)
              │           │           │
            Cubo        Cubo        Otro
           (Make)     (Web SDK)   proveedor
              │           │           │
              └───────────┼───────────┘
                          │
                   PaymentProvider
                          │
                    canStartCycle()
                          │
                   requestCycleStart()
                          │
                        ESP32
```

`PaymentProvider` is a factory (`createPaymentProvider({type, ...})`) over
one implementation per payment method:

- **`CuboCardProvider`** (`src/payment/cuboCardProvider.js`) — implemented
  and tested against a mock today. Wraps the Cubo Web SDK adapter
  (`src/cubo/cuboAdapter.js`) and the payment state machine
  (`src/payment/paymentStateMachine.js`).
- **`CuboQRProvider`** (`src/payment/cuboQRProvider.js`) — **deliberately
  not implemented.** Calling it always throws. It exists only to record
  the shape a future QR provider would have, based on the real,
  read-only-audited HX01/Make architecture (see "Adding a new payment
  method" below) — not to run anything.

Both implementations expose the same shape, so the rest of a machine's
code (UI, ESP32 authorization) never needs to know which payment method is
active:

| Method | Purpose |
|---|---|
| `selectService(service)` | Fix which priced service (e.g. BASIC Q20) is being paid for |
| `connectPos()` | Establish the POS/session link (card: Bluetooth connect; QR: conceptually a no-op) |
| `disconnectPos()` | Release it |
| `createPayment()` | Begin a payment attempt for the selected service |
| `cancelPayment()` | Local, best-effort cancel — see caveats below |
| `getStatus()` | Current state (one of the values in "Payment states") |
| `canStartCycle()` | `true` **only** when `getStatus() === 'PAYMENT_SUCCESS'` |
| `requestCycle()` | Ask to start the machine cycle — re-checks `canStartCycle()` itself, refuses otherwise |
| `onResult(handler)` | Subscribe to every state change, not just the final one |

`waitForResult()` was an earlier proposal for this list; it was dropped in
favor of `onResult()` because a single awaited promise collapses
intermediate states (`WAITING_FOR_CARD`, `PROCESSING_PAYMENT`) that the
security tests need to observe individually.

## Payment states

Every provider drives the same state machine
(`src/payment/paymentStateMachine.js`):

```
IDLE -> SERVICE_SELECTED -> PAYMENT_METHOD_SELECTED -> CONNECTING_POS -> POS_CONNECTED
  -> WAITING_FOR_CARD -> PROCESSING_PAYMENT -> {PAYMENT_SUCCESS | PAYMENT_DECLINED
     | PAYMENT_CANCELLED | PAYMENT_ERROR | PAYMENT_TIMEOUT}
```

Transitions are an explicit table with no wildcard/default case — an event
not listed for the current state throws instead of silently moving
somewhere unexpected. This is what caught a real bug during HX02's build:
a provider that sent a terminal outcome event directly from
`WAITING_FOR_CARD` (skipping `CARD_DETECTED`) got a thrown
`Invalid transition` error instead of a wrong state. Treat that kind of
failure as the system working, not as a bug to route around — the fix is
always to send the correct intermediate event, never to loosen the table.

## Security rules

**The single rule:** `canStartCycle()` returns `true` for exactly one
state, `PAYMENT_SUCCESS`, and `false` for every other state — including
ones that sound "close enough": POS connected, card detected, processing,
loading, or any terminal state that isn't success. This is implemented
once (`canStartCycle()` in `paymentStateMachine.js`) and re-checked again
independently by `requestCycleStart()` (`src/esp32/esp32Interface.js`)
right before authorizing a cycle — two checks of the same rule, not two
different rules.

**The manual-confirmation rule** (added after auditing HX01's real QR
flow): HX01's QR screen has a fallback button, "Confirmar pago
manualmente," that appears after 60 seconds and marks the payment
successful without any confirmation from Cubo. That may have been a
reasonable operational tradeoff for HX01 at the time it was built, but it
is explicitly **not** carried forward:

> A Hydrox machine must never start a cycle automatically based solely on
> a manual user action, when the payment method requires external
> confirmation.

Concretely: if a provider's payment method depends on an external party
confirming payment (Cubo's API, a webhook, a POS device), no button, timer,
or locally-manipulated state may substitute for that confirmation. A
`cancelPayment()` implementation is allowed to be "local-only" (see
`CuboCardProvider`'s docstring — no confirmed `cancel()` method exists on
the real SDK), but a `createPayment()`/success path is never allowed to be
local-only. When in doubt: only an event that genuinely originated from
the payment provider may drive a session to `PAYMENT_SUCCESS`.

**Never these, either** (from the original HX02 lab brief, still true):
opening the payment screen, connecting the POS, starting a transaction,
receiving a `loading`/`processing` signal, a customer cancelling, or a
timeout — none of these authorize a cycle. Only `PAYMENT_SUCCESS` does.

## Relationship to ESP32

Confirmed payment and machine authorization are two separate steps, on
purpose:

1. A provider reaching `PAYMENT_SUCCESS` does **not** automatically call
   anything on the ESP32. It only makes `canStartCycle()` return `true`.
2. Something else — a UI, an operator flow, a test — must explicitly call
   `provider.requestCycle()`.
3. `requestCycleStart()` re-checks the state itself and throws if it's
   anything but `PAYMENT_SUCCESS`. There's no bypass path.
4. As of this skill's writing, `requestCycleStart()`'s ESP32 transport is
   intentionally unimplemented (`Esp32NotImplementedError`) — HX02 hasn't
   defined GPIO/IP/WebSocket/MQTT/etc. for its own ESP32 yet, and HX01's
   protocol (plain HTTP `fetch()` to a local IP, see HX01's `app.js`) is a
   different machine's integration, not something to copy in without
   deciding it's right for HX02.

When HX02's real ESP32 protocol is defined, it plugs in behind
`requestCycleStart()` — the payment layer above it does not change.

## Per-machine configuration

Each machine gets a folder under `machines/<ID>/`:

- `machine.config.json` — non-secret: `machineId`, `machineName`,
  `location`, `cuboEnvironment`, `cuboPosSerial`, `cuboPosId`, `currency`,
  `currencyCodeIso4217`, `services.{basic,premium}.amount`, an `esp32`
  placeholder. `"enabled": false` marks a template that isn't a real
  machine yet (see `machines/HX03/`, `machines/HX04/`).
- `secrets.example.json` (committed template) / `secrets.local.json`
  (gitignored, real values) — the Cubo API key. Never in
  `machine.config.json`, never committed, never logged in full
  (`src/logger.js`'s `maskSecret()` exists for exactly this).

Adding HX03 means filling in that machine's `machine.config.json`,
flipping `enabled: true`, and providing its own secret — **not** touching
`src/`. If adding a machine ever seems to require a code change outside
its `machines/<ID>/` folder, that's a sign the abstraction has a gap worth
fixing generally, not a reason to special-case one machine's code path.

## Testing in sandbox / mock

No physical POS, tablet, or real Cubo credentials are available in a
development environment, so every provider's mock mode must be able to
exercise the full state space without hardware:

- POS lifecycle: connect, disconnect (before/after payment), connect
  failure.
- Every shape the real `transactionResult` is confirmed to take
  (`{success:true, data}`, a decline or SDK error via `{success:false,
  error:{type, message}}`, and — the one that most needs a dedicated test
  — `{success:false, pending:true, message}`), asserting `canStartCycle()`
  is `false` for every one of them except plain success, and that
  `pending: true` never transitions and never triggers a retry (see
  `interpretTransactionResult()` in `cuboCardProvider.js`).
- `requestCycle()` from every non-success state refuses; from
  `PAYMENT_SUCCESS` it passes the guard (see
  `tests/cuboCardProvider.test.js` and `tests/security.test.js` for the
  reference pattern — one test per state is deliberate, not
  boilerplate to trim).

Only after a mock-driven suite like that passes 100% does it make sense to
touch a real sandbox API key, and only in `web-sdk` mode with a key that's
never committed (typed into a runtime field or loaded from
`secrets.local.json`).

## Error handling

- **Fail closed, not silent.** An unrecognized `transactionResult.status`
  does not transition the session at all — it stays wherever it was,
  which is never `PAYMENT_SUCCESS`, so `canStartCycle()` stays `false`.
  This is deliberate: better an unhandled status hangs visibly (and gets
  logged) than gets guessed into a transition that might be wrong.
- **Distinguish "refused" from "not implemented."** `requestCycleStart()`
  throws two different errors on purpose: a plain `Error` when the
  state genuinely isn't `PAYMENT_SUCCESS` (a real refusal), and
  `Esp32NotImplementedError` when the state is correct but the transport
  isn't built yet (a scaffolding gap, not a security refusal). Tests and
  logs should keep telling these apart.
- **Never log sensitive data.** `src/logger.js` redacts anything matching
  `api[_-]?key|card|pan|cvv|pin|password|secret|token` in log context
  automatically; still never pass a full card number, CVV, or PIN into a
  log call in the first place — masking is a backstop, not a license.

## Process: adding a new payment method

1. Read `CUBO-INTEGRATION.md` (or the equivalent doc for the new
   provider) and separate CONFIRMED facts from UNVERIFIED assumptions.
   Don't skip this even if the method seems simple.
2. If real documentation/code for the method already runs somewhere (like
   HX01's QR flow does), audit it read-only first. Real running code beats
   assumptions — that's how `CuboQRProvider`'s documented-but-inert shape
   was derived, and why it doesn't guess at Make webhook payloads.
3. Write the provider's event-to-state-transition mapping against the
   *existing* `paymentStateMachine.js` — don't add new states or
   transitions unless the existing table genuinely can't express the new
   method's flow. If it can't, that's a deliberate, explained change to a
   shared, safety-critical file — not a per-provider workaround.
4. Implement against a mock first. No real credentials until the mock
   suite is green.
5. Test every non-success path explicitly refuses `canStartCycle()`, the
   same way `tests/cuboCardProvider.test.js` does. Don't just test the
   happy path.
6. Only then wire in real credentials, in sandbox, still without touching
   ESP32 authorization automatically — that stays a human/explicit call
   until it's proven end-to-end.

## Process: adding a new machine (HX03, HX04, ...)

1. Copy `machines/HX03/machine.config.json` (or the next available
   template), fill in the real `location`, `cuboPosSerial`, `cuboPosId`,
   confirmed prices, set `"enabled": true`.
2. Create that machine's `secrets.local.json` from `secrets.example.json`.
3. Point a `createPaymentProvider({ type, machineConfig, ... })` call at
   the new config. No changes to `src/payment/` or `src/cubo/` should be
   needed.
4. If the new machine needs a payment method that doesn't exist yet,
   follow "Process: adding a new payment method" above — once, for the
   method, not once per machine.
5. Define that machine's own ESP32 protocol when the time comes; it does
   not need to match HX01's or HX02's.

## Known open questions (check before trusting this doc blindly)

- The SDK's identity and `transactionResult`/`error`/`status` shapes are
  now CONFIRMED against Cubo's official demo repo
  (`github.com/Cubo-App/cubo-pos-sdk-web-demo`) — see `CUBO-INTEGRATION.md`
  for the full breakdown. What's still open: the exact field names inside
  `transactionResult.data` on success, and whether/how the SDK relates to
  the separate `api-payment-sandbox.cubopago.com` REST endpoint Cubo gave
  this project (nothing in the demo repo mentions it).
- Whether HX01's Make-side "payment marked used" step exists somewhere
  this audit didn't reach, and whether HX01's webhook token is actually
  validated server-side, are both open findings from the HX01 audit — not
  yet resolved, not this skill's job to fix.
- CuboQRProvider's real implementation (if/when it's built) needs its own
  read of this skill's security rules applied fresh — do not assume the
  HX01 pattern (Make + polling + a manual-confirm fallback) can be ported
  as-is; the fallback specifically must not be.
