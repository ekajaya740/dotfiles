#!/usr/bin/env python3
"""Enforce the 9Router settings that make the cheap path cheap.

`settingsRepo.js` ships `rtkEnabled: true` as its default, but `chat.js` reads
`!!chatSettings.rtkEnabled` off the *stored* blob, and `mergeWithDefaults` only
fills defaults on read — it never writes them back. So a gateway whose settings
row predates RTK starts up with RTK silently OFF, and the only symptom is a
larger bill. Same story for `comboStrategy`: absent means `fallback`, which
gives up the sticky session and re-pays the prompt cache on every failover.

This script PATCHes those two values (plus a threshold that actually trips for
a decisions-only router model) and verifies the read-back. It is idempotent and
safe to run against a live gateway: `PATCH /api/settings` merges, so nothing
else in the blob is disturbed.

Reads:
  - DB   : <DATA_DIR>/db/data.sqlite   (read-only, for the CLI token)
  - API  : http://127.0.0.1:20128

Run:  python3 9router/ensure-settings.py [--dry-run]
Exit: 0 already-correct or fixed; 1 gateway unreachable or write rejected.
"""
import argparse
import hashlib
import json
import pathlib
import sys
import urllib.error
import urllib.request

DATA_DIR = pathlib.Path("/home/personal/9router/data")
BASE = "http://127.0.0.1:20128"

# The values this stack depends on. `confidenceThreshold` is deliberately low:
# Jev reports 0.10-0.25 in practice, so the 0.8 default never clears the bar and
# smart routing silently degrades to plain fallback order.
REQUIRED = {
    "rtkEnabled": True,
    "comboStrategy": "smart",
}


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
    if not drift:
        print("9router settings already correct "
              f"({', '.join(f'{k}={v!r}' for k, v in REQUIRED.items())})")
        return 0

    print("9router settings drift: "
          + ", ".join(f"{k} is {live.get(k)!r}, want {v!r}" for k, v in drift.items()))
    if args.dry_run:
        print("--dry-run: not writing")
        return 0

    api("/api/settings", token, drift)

    after = current(token)
    bad = {k: after.get(k) for k, v in REQUIRED.items() if after.get(k) != v}
    if bad:
        print(f"write did not stick: {bad}", file=sys.stderr)
        return 1
    print("fixed: " + ", ".join(f"{k}={v!r}" for k, v in REQUIRED.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
