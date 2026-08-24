# Machine Configuration Catalog

Goal: adding HX03, HX04, HX05... should only ever mean **registering a new
config**, never touching the application logic.

## Layout

```
machines/
  HX02/
    machine.config.json    non-secret config, committed
    secrets.example.json   template only, committed (no real values)
    secrets.local.json     real secrets, gitignored, created locally per machine
  HX03/
    machine.config.json    "enabled": false placeholder — not a real machine yet
  HX04/
    machine.config.json    same
```

`src/config/loadMachineConfig.js` reads `machines/<ID>/machine.config.json`
at runtime and refuses to load a config with `"enabled": false` — that's
what keeps the HX03/HX04 placeholders from being mistaken for real,
addressable machines.

## `machine.config.json` fields

| Field | Meaning |
|---|---|
| `enabled` | `false` for placeholder/template entries; set `true` once the machine is real |
| `machineId` | e.g. `"HX02"` |
| `machineName` | display name, e.g. `"FreshTouch HX02"` |
| `location` | physical location, free text |
| `cuboEnvironment` | `"sandbox"` or `"production"` |
| `cuboPosSerial` | Cubo QPOS Cute serial for this machine |
| `cuboPosId` | Cubo POS ID for this machine |
| `currency` | ISO alpha code, e.g. `"GTQ"` |
| `currencyCodeIso4217` | 4-digit numeric code Cubo's SDK expects, e.g. `"0320"` for GTQ |
| `services.basic.amount` / `services.premium.amount` | prices in whole currency units (Quetzales), converted to cents when calling `startPayment` |
| `esp32` | placeholder object — Phase 2, see `CUBO-INTEGRATION.md` |

None of these are secrets. They can be committed safely.

## Secrets

The only secret is the Cubo API key (and, later, production credentials).
It never lives in `machine.config.json` or anywhere else in the repo:

- `machines/<ID>/secrets.example.json` is a committed template with a
  placeholder value.
- `machines/<ID>/secrets.local.json` is the real file, listed in
  `.gitignore`, created locally by whoever runs the lab against real
  hardware.
- Alternatively (and this is what the lab UI supports today), the API key
  can be typed directly into the lab screen at runtime — it stays in a JS
  variable for that page load only, is never written to disk, and is
  masked (`maskSecret()` in `src/logger.js`) anywhere it might otherwise
  appear in a log line.

## Adding HX03 (or any new machine)

1. Copy `machines/HX03/machine.config.json`, fill in the real
   `location`, `cuboPosSerial`, `cuboPosId`, and confirmed prices.
2. Set `"enabled": true`.
3. Create `machines/HX03/secrets.local.json` from
   `machines/HX03/secrets.example.json` with the real sandbox API key (or
   enter it in the lab UI at runtime).
4. Point the lab at `HX03` — nothing in `src/` needs to change.

## Moving to production

Per machine, once sandbox testing is verified end-to-end on real hardware:

1. Obtain `CUBO_API_KEY_PRODUCTION` and confirm `PRODUCTION_APPROVED` with
   Cubo (see `CUBO-INTEGRATION.md`).
2. Flip that machine's `cuboEnvironment` to `"production"`.
3. Swap the production secret in the same way sandbox secrets are handled —
   never commit it.
4. Re-run the full manual hardware checklist in `TEST-PLAN.md` against
   production before relying on it for real transactions.

This is a config change per machine, not a code change.
