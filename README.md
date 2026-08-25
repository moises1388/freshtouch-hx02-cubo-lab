# FreshTouch HX02 — Cubo Payment Integration Lab

Experimental, isolated lab for integrating card payments (Cubo QPOS Cute,
via the Cubo Web SDK) into a second FreshTouch machine, HX02.

## Isolation from HX01

**HX01 is in production and was not touched.** No file outside this
directory (`freshtouch-hx02-cubo-lab/`) was created, edited, or deleted to
build this lab — `app.js`, `config.js`, `freshtouch_app.html`, `index.html`,
`styles.css` and `img/` at the repo root belong to HX01 and are unrelated to
this work.

The task brief called for a fully separate repository
(`freshtouch-hx02-cubo-lab`). This session only has push access to the
`moises1388/freshtouch-hx01` repo, on the branch
`claude/freshtouch-hx02-cubo-lab-0agqa5`, so isolation is enforced at the
file level instead: this lab lives in its own top-level folder, has its own
`package.json`, imports nothing from HX01's files, and none of HX01's files
import from here. If a genuinely separate GitHub repository is required,
this folder can be copied out wholesale — it has no path dependency on the
rest of the HX01 repo. Say the word and it can be moved.

## What this lab is (and isn't)

This is **phase 1 only**: proving the software layer end-to-end — page
loads, state machine, Cubo adapter contract, on-screen diagnostics, and the
security rule that only `PAYMENT_SUCCESS` may request a machine cycle.

It is **not** a working Bluetooth/hardware integration yet, because this
development environment has none of what real-hardware testing needs:

- No physical tablet, no Bluetooth radio.
- No sandbox API key entered anywhere yet, and no POS serial (see
  [`CUBO-INTEGRATION.md`](./CUBO-INTEGRATION.md) for the exact list of
  still-pending fields — Cubo has approved Sandbox access).
- `developers.cubopago.com` itself is still unreachable from this
  container (network egress to that domain is blocked here), but Cubo's
  official demo repo — `github.com/Cubo-App/cubo-pos-sdk-web-demo` — is
  reachable and was cloned and read directly, which resolved almost
  everything that page would have.

So the lab ships with a **mock Cubo adapter** that simulates the whole
`connect → startPayment → transactionResult` flow using the real,
confirmed `CuboPagoSDK` shapes, and a **real adapter** wired to the same
interface (`window.CuboPagoSDK`), ready for someone with a tablet, Chrome,
Bluetooth and a real sandbox API key to point at hardware.

## Structure

```
freshtouch-hx02-cubo-lab/
├── README.md                 you are here
├── CUBO-INTEGRATION.md       Cubo SDK research: confirmed vs unverified, HTTPS/localhost findings
├── MACHINE-CONFIG.md         machine catalog convention, how to add HX03/HX04
├── TEST-PLAN.md              test matrix + manual hardware checklist
├── machines/                 one config folder per physical machine
│   ├── HX02/machine.config.json
│   ├── HX02/secrets.example.json   (template only — never real secrets)
│   ├── HX03/machine.config.json    (disabled placeholder)
│   └── HX04/machine.config.json    (disabled placeholder)
├── src/
│   ├── config/loadMachineConfig.js
│   ├── cubo/                 adapter interface + mock + real-SDK stub
│   ├── payment/
│   │   ├── paymentStateMachine.js   the safety-critical module
│   │   ├── paymentProvider.js       PaymentProvider contract + factory
│   │   ├── cuboCardProvider.js      card payments — implemented, mock-tested
│   │   └── cuboQRProvider.js        QR — documented shape only, inert, not implemented
│   ├── esp32/esp32Interface.js          conceptual stub only, Phase 2
│   └── logger.js             sensitive-data-safe logging
├── .claude/skills/hydrox-payment-architecture/SKILL.md   the reusable process doc
├── lab/                       the test screen (lab.html/js/css)
└── tests/                     node:test unit tests (no dependencies)
```

## PaymentProvider architecture

`src/payment/paymentProvider.js` sits above the state machine and the Cubo
adapter as the common interface every payment method will implement —
today only `CuboCardProvider` actually works (mock-tested); `CuboQRProvider`
is a deliberately inert stub documenting QR's future shape from HX01's real,
audited flow, without connecting to anything. See
`.claude/skills/hydrox-payment-architecture/SKILL.md` for the full
architecture, security rules, and the process for extending it to a new
payment method or a new machine (HX03, HX04, ...). `lab/lab.js` talks only
to `PaymentProvider` — it has no direct import of the Cubo adapter or the
state machine.

## Running the lab UI

The SDK requires a secure context (HTTPS, or `http://localhost` for
development — see `CUBO-INTEGRATION.md`). Serve the folder locally, e.g.:

```bash
cd freshtouch-hx02-cubo-lab
python3 -m http.server 8080
# open http://localhost:8080/lab/lab.html
```

By default the page uses the **Simulated** adapter mode — no hardware, no
API key, no network calls. Switch to **Real Cubo Web SDK** mode once the
official `<script src="https://sdk.cubopago.com/pos/vX.Y.Z/cubo-pos-sdk-web.js">`
tag (commented out at the top of `lab/lab.html`, version to be
double-checked — see `CUBO-INTEGRATION.md`) is uncommented and a sandbox
API key is available; the key is typed into a password field at runtime
and is never written to disk or logged. Until the script is loaded, the
page shows *"script not loaded yet"* and keeps CONNECT POS disabled rather
than letting a click fail after the fact.

## Running the tests

```bash
cd freshtouch-hx02-cubo-lab
npm test    # node --test — no dependencies to install
```

53 unit tests cover the payment state machine, the ESP32 safety guard, the
mock Cubo adapter (emitting the real, confirmed `transactionResult` shape),
and the `CuboCardProvider`/`CuboQRProvider` layer — including that
`pending: true` never authorizes a cycle and never gets retried
automatically. See `TEST-PLAN.md` for the full matrix, including the
manual hardware checklist that can't be automated from here.

## Status against the phase-1 checklist

| # | Goal | Status |
|---|------|--------|
| 1 | FreshTouch page loads | ✅ `lab/lab.html` loads and renders the test screen |
| 2 | Cubo SDK Web initializes | ✅ **Confirmed on real hardware** — real `CuboPagoSDK` script + sandbox API key initialized successfully on the HX02 tablet |
| 3 | Tablet detects POS | ✅ **Confirmed on real hardware** — Chrome's native Bluetooth picker showed the real QPOS Cute |
| 4 | Tablet connects via Bluetooth | ✅ **Confirmed on real hardware** — real pairing completed |
| 5 | POS state CONNECTED | ✅ Simulated; ✅ **real** — `pos-status: Connected`, `r-connection: CONNECTED` on real hardware |
| 6 | Send test amount | ✅ **Confirmed on real hardware** (PRODUCTION environment, Q20 BASIC) |
| 7 | Cubo requests card | ✅ **Confirmed on real hardware** — real signature screen shown on the POS |
| 8 | Result received | ✅ **Confirmed on real hardware** — real `PAYMENT_SUCCESS`, transaction visible in the Cubo Admin app. `result.data`'s real field names are still unconfirmed: the lab's placeholder `transactionId` key came back empty on this real success, so the actual field name(s) inside `data` remain UNVERIFIED |
| 9 | Result shown on screen | ✅ Working in the lab UI |
| 10 | Local debug info logged | ✅ Sensitive-safe logger + on-screen log panel |

See the end-of-task report requested in the brief for the full breakdown —
this table is the short version.

## Next steps (do not start automatically)

1. ~~Generate the sandbox API key~~ — sandbox never worked (see
   `CUBO-INTEGRATION.md`'s environment note); the machine owner switched
   `cuboEnvironment` to `production` after confirming with Cubo support.
   **This lab now makes real charges on real cards.**
2. ~~Confirm the current SDK script version~~ — done, v1.11.0 confirmed
   working end-to-end on real hardware.
3. ~~Run this lab on the real HX02 tablet~~ — done: `connect()`, and a
   full real `PAYMENT_SUCCESS` (Q20, PRODUCTION), both confirmed.
4. Design the `PAYMENT_SUCCESS → ESP32 → start cycle` protocol — a
   separate, explicitly-approved step, and never against HX01. This is
   the next real piece of work; `esp32Interface.js` still refuses on
   purpose (`Esp32NotImplementedError`) until that protocol exists.
