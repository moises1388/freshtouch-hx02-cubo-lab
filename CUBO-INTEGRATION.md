# Cubo Web SDK Integration — Research Findings

Primary source: Cubo's own official demo repository,
[github.com/Cubo-App/cubo-pos-sdk-web-demo](https://github.com/Cubo-App/cubo-pos-sdk-web-demo)
(cloned and read directly in this session: `README.md`, `demo.html`,
`src/app.js`, `llms.txt`, and
`.claude/skills/cubo-sdk-help/references/*.md`). This is real, working
example code and documentation from Cubo — not search-engine summaries,
not guesses.

## How this was researched, and its limits

Earlier passes tried `developers.cubopago.com/sdks/web-sdk` directly and
were blocked: `WebFetch` returns `EGRESS_BLOCKED`, and a raw `curl`
through this environment's egress proxy confirms a policy-level `403` on
that domain and `www.cubopago.com` — re-checked across three different
proxy ports as the session reconnected, so it's the network policy, not a
transient failure. Two earlier passes were built from (1) web-search
cached summaries of that docs page, then (2) the machine owner reading
that page directly in their own browser and reporting it back. Both left
several items genuinely unverified, most importantly the SDK's global
class name and the exact `transactionResult` payload shape.

**This pass supersedes those.** The machine owner obtained the URL of
Cubo's official demo repository and this session cloned it directly
(`github.com` is reachable even though `cubopago.com` is not) and read
every file in it. Everything under CONFIRMED below comes from that repo.
Anything still marked UNVERIFIED was checked for and genuinely not found
in it — not merely unread.

A separate, real npm registry search (done in an earlier pass; still
valid) found no plausible `cubopago`-branded npm package — consistent with
what the demo repo confirms: the SDK is distributed as a versioned
`<script>` tag from `sdk.cubopago.com`, with `cubo-pos-sdk-web` also
published to npm for bundler-based projects (see below).

## CONFIRMED

- **Global class name is `CuboPagoSDK`** (`window.CuboPagoSDK`) — earlier
  passes had guessed `CuboSDK`; that was wrong, now corrected everywhere
  in this lab's code.
- **Script tag**: `<script src="https://sdk.cubopago.com/pos/vX.Y.Z/cubo-pos-sdk-web.js"></script>`.
  The demo repo's own three docs disagree on the current version — its
  `.claude/skills/cubo-sdk-help/SKILL.md` says `v1.1.1`, its `README.md`
  says `v1.10.0`, but its own `demo.html` (live, runnable code, the most
  trustworthy of the three) pins `v1.11.0`. Confirm the current version
  before shipping — don't assume any of these three numbers is still
  current by the time this is read.
- **npm package**: `cubo-pos-sdk-web`.
- **Works only with the Cubo QPOS Cute** terminal model, over the
  **Web Bluetooth API**.
- **Init**: `new CuboPagoSDK({ apiKey, environment, enableMsi?, msiModal?, hasPrinter? })`.
  - `apiKey` (string) and `environment` (string) are both required —
    throws synchronously if either is missing.
  - `environment` is one of the literal, **uppercase** strings
    `'SANDBOX'` / `'PRODUCTION'` (two of the demo repo's docs also list
    `'STG'` / `'DEV'`). This lab's own `machine.config.json` convention is
    lowercase (`'sandbox'`) — `webSdkCuboAdapter.js` now upper-cases it at
    the point of use, so the config file's convention doesn't need to
    change.
  - `enableMsi`, `msiModal`, `hasPrinter` are optional, all default to
    values HX02 doesn't need to override (MSI/installments and receipt
    printers are out of scope for HX02's flat BASIC/PREMIUM pricing) —
    not passed by this lab's adapter.
- **Requires a secure context**: HTTPS in production, `http://localhost`
  for development only. Confirms the earlier HTTPS/localhost findings
  below unchanged.
- **Supported browsers**: Chrome 56+ (Desktop **and Android**), Edge 79+
  (**Desktop only**), Opera 43+ (Desktop and Android). Not Safari, not
  Firefox, on any platform.
- **Public properties**: `isConnected` (boolean), `device`
  (`BluetoothDevice | null`).
- **Methods**: `connect(): Promise<string>` (resolves with the connected
  device's name; requires a user gesture — must be called from a click
  handler), `disconnect(): void`, `startPayment(params): Promise<void>`
  (throws synchronously on validation errors), `cancelCurrentTransaction(): boolean`
  (aborts the in-flight HTTP call for the current payment; not currently
  wired into this lab's `CuboCardProvider`), `getDeviceInfo()`,
  `getPosId()`, `getInstallments()`, `getInstallmentCalculation()`
  (MSI-only, unused by HX02), `on(event, callback)`, `off(event, callback?)`,
  `removeAllListeners()`.
- **`startPayment({ amount, currencyCode, currencySymbol, monthlyInstallmentId? })`**:
  - `amount`: a **string** of cents, e.g. `"2000"` for Q20.00 — not the
    number `2000`. (This lab's earlier code passed a number; fixed in
    `cuboCardProvider.js`.)
  - `currencyCode`: ISO 4217 numeric code as a string — `"0320"` GTQ,
    `"0840"` USD, `"0484"` MXN.
  - `currencySymbol`: display string, e.g. `"Q"`, `"$"`.
  - `monthlyInstallmentId`: MSI-only, unused by HX02.
- **Events, subscribed via `on()`**: `connected`, `disconnected`, `status`,
  `loading`, `transactionResult`, `error`, `installmentsLoaded`
  (MSI-only).
  - `connected` payload: `{ deviceName: string }`.
  - `disconnected` payload: none.
  - `status` payload: the status **string itself** (not wrapped in an
    object). **Not a closed enum** — during automatic payment recovery the
    SDK also emits free-form Spanish progress messages (e.g. *"Estamos
    confirmando tu pago con el banco..."*) outside the named list below.
    Named connection/verification/payment values: `searching`,
    `connecting`, `connected`, `disconnected`, `verifying_pos`,
    `preparing_pos_configuration`, `configuring_pos`,
    `verification_failed`, `configuring_failed`, `waiting_for_card`,
    `processing_payment`, `payment_success`, `payment_failed`,
    `payment_pending`, `transaction_terminated`.
    (Two of the demo repo's own docs — `llms.txt` and the Claude skill's
    inline comments — abbreviate this to `'processing'` and omit
    `transaction_terminated`; `README.md`'s full structured table is more
    detailed and is what this lab follows. Worth reconciling if a future
    pass finds the abbreviated version is actually the current behavior.)
  - `loading` payload: boolean.
  - **`transactionResult` payload — the shape that matters most**:
    `{ success: boolean, data?: object, pending?: boolean, message?: string, error?: { type: string, message: string } }`.
    This is a completely different shape from what this lab's code
    guessed before this pass (`{ status: 'SUCCESS' | 'DECLINED' | ... }`
    with `transactionId`/`referenceId`/`authorizationCode`/`readType`
    fields) — none of those field names turned out to be real. The exact
    internal shape of `data` on success is still not documented beyond
    "the full API response" — see UNVERIFIED below.
  - `error` payload: `{ type: string, message: string }`. Confirmed
    `type` values: `not_connected`, `connection_failed`, `invalid_amount`,
    `invalid_currency_code`, `invalid_currency_symbol`, `sdk_error`,
    `transaction_declined`, `transaction_not_found`,
    `recovery_in_progress`.
- **Automatic payment recovery**: the SDK has its own built-in mechanism
  for ambiguous network failures (timeout ~3 min, dropped connection,
  gateway 502/503/504) — every payment carries an auto-generated
  Idempotency Key so any retry the SDK performs internally can't double-
  charge, and progressively polls transaction status (surfaced via
  `status` event messages) while it does. If it still can't confirm the
  outcome after recovering, the SDK emits a `transactionResult` with
  `pending: true`. **Do not retry `startPayment()` automatically on
  `pending: true`** — the docs are explicit that this risks a double
  charge. This lab's
  `cuboCardProvider.js` treats `pending: true` as fail-closed: no state
  transition, `canStartCycle()` stays `false`, nothing is retried
  automatically — see that file's comments for the exact reasoning.

## UNVERIFIED — still not found anywhere in the demo repo

- **The exact field names inside `transactionResult.data`** on success —
  described only as "the full API response," no fields documented or
  shown in example output. `mockCuboAdapter.js`'s placeholder
  (`transactionId`, `amount`, `currencySymbol`, `timestamp`) is explicitly
  not a claim about real field names.
- **Whether/how the SDK relates to `api-payment-sandbox.cubopago.com`** —
  the REST endpoint Cubo separately gave this project (matching the
  naming pattern of the production REST API this project's HX01 audit
  found powering HX01's QR flow, `api-payment-a.cubopago.com`). Nothing in
  the demo repo — docs, demo app, or its own Claude skill — mentions that
  hostname anywhere. The SDK is served from a different host
  (`sdk.cubopago.com`) and appears to manage all backend communication
  internally; this project's code has never needed to reference that REST
  endpoint directly for the card flow, and nothing here assumes it does.
- Real payment behavior specifically — `startPayment()` and
  `transactionResult` have not been run against real hardware yet
  (deliberately: `connect()`-only first, no charges). The exact
  `transactionResult.data` field names on success and the `pending: true`
  path are still unconfirmed against a real transaction.

**Update — real hardware, `connect()` only (2026):** confirmed on the
actual HX02 tablet against the physical QPOS Cute (S/N
`29600100122031610810`), no code changes needed beyond fixing a lab-only
provider-retry bug (see git history, `lab.js`). No registration/pairing
step in Cubo Admin Sandbox was needed beyond generating the API key —
`connect()` alone was sufficient. Confirmed working: the real
`CuboPagoSDK` script loads, initializes with a sandbox key, `connect()`
triggers Chrome's native Bluetooth device picker, the QPOS Cute is found
and pairs, and the `connected` event fires (`pos-status: Connected`,
`r-connection: CONNECTED` in the lab UI). Not yet captured: the real
`deviceName` string from that event — the lab UI doesn't display it
today (see `TEST-PLAN.md`). `startPayment()` still hasn't been run for
real — that's the next, separately-approved step.

**Action needed:** the remaining items need either a real sandbox
`connect()`/`startPayment()` run with the raw events logged, or a direct
question to Cubo (see the machine owner's question list from the prior
research round for `api-payment-sandbox.cubopago.com` specifically).

## How to activate `mode: real`

Updated now that the SDK identity is confirmed — only the API key and a
live-device check remain:

1. **Script tag** — uncomment the `<script src="https://sdk.cubopago.com/pos/v1.11.0/cubo-pos-sdk-web.js">`
   tag at the top of `lab/lab.html`, double-checking the version number is
   still current first (see the version discrepancy noted above).
2. **Global / init call** — already fixed: `webSdkCuboAdapter.js` now uses
   `window.CuboPagoSDK` and passes `environment` upper-cased. No further
   guessing needed here.
3. **`transactionResult.data` shape** — still a placeholder in the mock;
   once a real `startPayment()` succeeds against sandbox, capture the real
   `data` object and update both `mockCuboAdapter.js`'s placeholder and
   this doc's UNVERIFIED section.
4. **API key** — type it into the lab's "API Key" field at runtime (never
   committed), or put it in `machines/HX02/secrets.local.json` (gitignored,
   copy from `secrets.example.json`). Never in `machine.config.json`,
   never in a commit.
5. **First real test is `connect()` only** — select "Real Cubo Web SDK"
   mode, connect the POS, confirm `CONNECTED` on screen with a real
   `deviceName`. No `startPayment()` yet. Only after that works, and only
   in `SANDBOX`, try a real `startPayment()` — still no ESP32 involved
   (see `requestCycleStart()`, still `Esp32NotImplementedError` by
   design).

## HTTPS / localhost

Unchanged from earlier research, now doubly confirmed by the demo repo's
own prerequisites section:

1. **HX02 doesn't have a deployed app yet** — this lab is the first HX02
   code to exist. There's nothing running in production to inspect.
2. **HX01** (the sibling machine, for context only — not modified) has no
   CI/deploy config, `CNAME`, or hosting manifest checked into its repo, so
   its hosting setup isn't discoverable from the repository alone.
3. **For this lab today**: serve `freshtouch-hx02-cubo-lab/` over
   `http://localhost:<port>` (e.g. `python3 -m http.server`, or the demo
   repo's own suggestion, `npx serve .`). `localhost` satisfies the
   secure-context rule for development — sufficient for all Phase 1
   testing, including with a real tablet, as long as the tablet's browser
   loads the page from `localhost` on that same device.
4. **For a real tablet in the field** (not localhost), HTTPS is required.
   Recommended, in order of effort: (a) a static host that provides HTTPS
   automatically (GitHub Pages, Netlify, Vercel) if HX02 will be served
   remotely; (b) a local HTTPS dev certificate (e.g. via `mkcert`) if HX02
   must run fully offline from a local server. No insecure workaround was
   implemented or is recommended.
5. This decision needs to be made deliberately once it's known how HX02
   will actually be deployed (offline kiosk vs. hosted) — not assumed here.

## Pending information from Cubo

| Field | Status |
|---|---|
| `CUBO_ACCOUNT` | Pending |
| `CUBO_MERCHANT_ID` | Pending |
| `CUBO_API_KEY_SANDBOX` | Cubo Admin Sandbox is now enabled to generate it — not yet generated/entered anywhere in this repo |
| `CUBO_API_KEY_PRODUCTION` | Pending — do not request until sandbox is proven |
| `POS_MODEL` | Confirmed QPOS Cute |
| `POS_SERIAL` | Pending |
| `POS_ID` | Pending |
| `SANDBOX_ENABLED` | **Confirmed enabled** by Cubo |
| `PRODUCTION_APPROVED` | Not applicable yet — Phase 1 only |
| `CUBO_CONTACT` | Have a working channel (sandbox was approved through it) |
| `CUBO_REQUIREMENTS` | Sandbox approved with no blocking requirement reported so far |
| `api-payment-sandbox.cubopago.com` role | Given by Cubo; not referenced anywhere in the SDK demo repo — see UNVERIFIED above |

Track these in `machines/HX02/machine.config.json` (non-secret fields) and
`machines/HX02/secrets.local.json` (gitignored, secret fields — copy from
`secrets.example.json`). Never fill placeholders with fictitious values "to
make it work" — the mock adapter exists specifically so the rest of the
system can be built and tested without real credentials.

## Architecture: the adapter interface

`src/cubo/cuboAdapter.js` exposes one factory,
`createCuboAdapter({ mode: 'mock' | 'web-sdk', machineConfig, apiKey })`,
returning `{ connect, disconnect, startPayment, on }` either way. The rest
of the app (state machine, UI, ESP32 guard) only ever talks to that shape,
so swapping the mock for the real SDK — now that the SDK's own identity is
confirmed — should not require touching anything outside
`src/cubo/webSdkCuboAdapter.js`.

One layer up, `src/payment/cuboCardProvider.js` wraps this adapter plus the
payment state machine into the `PaymentProvider` shape shared with (future)
other payment methods — see
`.claude/skills/hydrox-payment-architecture/SKILL.md` for that architecture.
This is also where the real `transactionResult` shape gets interpreted
into state-machine events (see `interpretTransactionResult()` in that
file) — the adapters themselves (mock and real) pass the raw shape through
unmodified.

## ESP32 (Phase 2, not started)

Per the brief, no ESP32 transport was assumed or implemented. HX01's
firmware/protocol (HTTP GET to a local IP, seen in HX01's `app.js` for
reference only — not copied, not modified) is a different machine's
integration and isn't reused here. `src/esp32/esp32Interface.js` only
enforces the one rule that's already certain — "only PAYMENT_SUCCESS may
request a cycle" — and otherwise throws `Esp32NotImplementedError`. The
actual HX02 protocol (GPIO/IP/WebSocket/MQTT/etc.) is an open question for
a later phase, once HX02's existing hardware (if any) has been inspected.
