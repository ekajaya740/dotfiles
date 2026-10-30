#!/usr/bin/env python3
"""Enforce the 9Router settings that make the cheap path cheap.

`settingsRepo.js` ships `rtkEnabled: true` as its default, but `chat.js` reads
`!!chatSettings.rtkEnabled` off the *stored* blob, and `mergeWithDefaults` only
fills defaults on read — it never writes them back. So a gateway whose settings
row predates RTK starts up with RTK silently OFF, and the only symptom is a
larger bill.

`comboStrategy` is pinned to `fallback` on purpose. The smart router asks Jev to
choose between combo members and passes `buildChoiceCriteria()`, which maps
every model to a bare `null` — the judge sees no price, no latency, no cache
rate, only vendor names. Its confidence sits at 0.07-0.58 (p50 ~0.13), so at the
0.8 default it rejects and the request falls through to the cheapest-first order
anyway, after paying a ~500 ms round trip on every first turn. Worse, a rejection
never writes a sticky entry, so the `strict` lock can never engage and the judge
is re-consulted on every turn. Two of the four heterogeneous combos cannot be
improved by a router at all: coder/advisor/personal-chat differ only by provider
of the same model, and smol's members are a free 31B and a paid flash. Ordering
already encodes the policy, so the router only adds latency and a failure mode.

This script PATCHes the two settings, downgrades any leftover `smart` combo row
to `fallback`, and verifies the read-back. It is idempotent and safe to run
against a live gateway: `PATCH /api/settings` merges, so nothing else in the
blob is disturbed.

Reads:
  - DB   : <DATA_DIR>/db/data.sqlite   (read-only, for the CLI token)
  - API  : http://127.0.0.1:20128

Run:  python3 9router/ensure-settings.py [--dry-run]
Exit: 0 already-correct or fixed; 1 gateway unreachable or write rejected.
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

# The gateway's data dir is wherever 9router is installed on this machine. It is
# machine-local, so it comes from the environment rather than a committed
# absolute path; the default matches the usual `~/.9router`-style install.
DATA_DIR = pathlib.Path(
    os.environ.get("NINEROUTER_DATA_DIR", pathlib.Path.home() / "9router" / "data")
)
BASE = "http://127.0.0.1:20128"

# The values this stack depends on.
REQUIRED = {
    "rtkEnabled": True,
    "comboStrategy": "fallback",
}

# Keys that only exist to configure the smart router. Left behind they look
# live in the dashboard and cost a round trip on every turn.
SMART_KEYS = ("smartPolicy", "routerModel", "confidenceThreshold", "judgeModel")


def cli_token() -> str:
    """Derive the CLI admin token exactly as src/shared/utils/machineId.js does."""
    raw = (DATA_DIR / "machine-id").read_text().strip()
    secret = (DATA_DIR / "auth" / "cli-secret").read_text().strip()
    return hashlib.sha256(f"{raw}9r-cli-auth{secret}".encode()).hexdigest()[:16]


def api(path: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"x-9r-cli-token": token, "Content-Type": "application/json"},
        method="PATCH" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")


def current(token: str) -> dict:
    doc = api("/api/settings", token)
    return doc.get("settings", doc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = cli_token()
    try:
        live = current(token)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"gateway not reachable at {BASE}: {e}", file=sys.stderr)
        return 1

    drift = {k: v for k, v in REQUIRED.items() if live.get(k) != v}

    # Downgrade any combo still routed by the judge, and drop its now-dead keys.
    strategies = live.get("comboStrategies") or {}
    smart = sorted(name for name, cfg in strategies.items()
                   if (cfg or {}).get("fallbackStrategy") == "smart")
    if smart:
        for name in smart:
            cfg = dict(strategies[name])
            cfg["fallbackStrategy"] = "fallback"
            for key in SMART_KEYS:
                cfg.pop(key, None)
            strategies[name] = cfg
        drift["comboStrategies"] = strategies

    if not drift:
        print("9router settings already correct "
              f"({', '.join(f'{k}={v!r}' for k, v in REQUIRED.items())}, "
              "no smart-routed combos)")
        return 0

    shown = dict(drift)
    if "comboStrategies" in shown:
        shown["comboStrategies"] = f"{len(smart)} combo(s) downgraded to fallback"
    print("9router settings drift: "
          + ", ".join(f"{k} is {live.get(k)!r}, want {shown[k]!r}" for k in shown))
    if args.dry_run:
        print("--dry-run: not writing")
        return 0

    api("/api/settings", token, drift)

    after = current(token)
    bad = {k: after.get(k) for k, v in REQUIRED.items() if after.get(k) != v}
    leftover = [name for name, cfg in (after.get("comboStrategies") or {}).items()
                if (cfg or {}).get("fallbackStrategy") == "smart"]
    if leftover:
        bad["comboStrategies"] = f"{len(leftover)} still smart: {leftover[:3]}"
    if bad:
        print(f"write did not stick: {bad}", file=sys.stderr)
        return 1
    print("fixed: " + ", ".join(f"{k}={v!r}" for k, v in REQUIRED.items())
          + (f", {len(smart)} combo(s) downgraded" if smart else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
