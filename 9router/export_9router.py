#!/usr/bin/env python3
"""Export the personal 9Router config to a secrets-masked snapshot.

Regenerates `9router/config-export.json` from the LIVE gateway at
127.0.0.1:20128 so the dotfiles backup matches reality. Credential-named fields
are dropped outright — the snapshot carries no key material at all, not even a
masked tail — and a value-shaped gate over the finished document aborts the run
if anything key-like survives.

Reads:
  - DB   : <DATA_DIR>/db/data.sqlite   (read-only)
  - API  : http://127.0.0.1:20128      (admin routes, x-9r-cli-token)

Writes:
  - 9router/config-export.json

Run:  python3 9router/export_9router.py [--dry-run]
"""
import argparse
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request

DATA_DIR = pathlib.Path("/home/personal/9router/data")
DB_PATH = DATA_DIR / "db" / "data.sqlite"
BASE = "http://127.0.0.1:20128"
OUT = pathlib.Path(__file__).resolve().parent / "config-export.json"

MASKED_FIELDS = {"apiKey", "api_key", "password", "token", "secret", "jwtSecret"}
# Value-shaped gate, applied to the WHOLE document after masking. Each pattern
# is a provider key prefix that has actually been seen in this stack; the
# catch-all covers the bare `sk-` forms (`sk-or-v1-`, `sk-proj-`, …) that the
# narrower prefixes would miss. A match aborts the export, so a false positive
# costs a re-run, never a leak.
SECRET_RE = re.compile(
    r"(sk_live_[A-Za-z0-9]{16}"
    r"|sk-or-v1-[A-Za-z0-9]{16,}"
    r"|sk-proj-[A-Za-z0-9_-]{16,}"
    r"|sk-[A-Za-z0-9_-]{20,}"
    r"|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|gho_"
    r"|AKIA[0-9A-Z]{16}"
    r"|scrypt\$"
    r"|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."
    r"|BEGIN [A-Z ]*PRIVATE KEY)"
)


def cli_token() -> str:
    """Derive the CLI admin token exactly as src/shared/utils/machineId.js does."""
    raw = (DATA_DIR / "machine-id").read_text().strip()
    secret = (DATA_DIR / "auth" / "cli-secret").read_text().strip()
    return hashlib.sha256(f"{raw}9r-cli-auth{secret}".encode()).hexdigest()[:16]


def api(path: str, token: str):
    req = urllib.request.Request(BASE + path, headers={"x-9r-cli-token": token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")


def scrub(obj):
    """Drop secret-bearing fields anywhere in the structure.

    The committed snapshot carries NO key material at all — not even a masked
    tail. `apiKey` is the only secret the gateway stores per connection, and
    restore re-enters it by hand (see README).
    """
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items() if k not in MASKED_FIELDS}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


def from_db(query: str, cols):
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        for row in con.execute(query):
            yield dict(zip(cols, row))
    finally:
        con.close()


def build(token: str) -> dict:
    # `type` and `name` live in COLUMNS, not in the `data` blob. Dropping them
    # silently loses the node kind on restore — an `anthropic-compatible` node
    # would come back as a plain openai-compatible one, and every Claude model
    # on it would fail with a shape mismatch.
    nodes = []
    for n in from_db(
        "SELECT id, type, name, data, createdAt, updatedAt FROM providerNodes",
        ["id", "type", "name", "data", "createdAt", "updatedAt"],
    ):
        # Pop BEFORE unpacking: `{**n, **json.loads(n.pop("data"))}` evaluates
        # `**n` first, so the raw `data` blob would ride along into the output.
        extra = json.loads(n.pop("data"))
        nodes.append(scrub({**n, **extra}))

    conns = from_db(
        "SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt "
        "FROM providerConnections",
        ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"],
    )
    connections = []
    for c in conns:
        # Pop BEFORE unpacking: `{**c, **json.loads(c.pop("data"))}` evaluates
        # `**c` first, so the raw `data` blob (holding apiKey) rides along.
        raw = json.loads(c.pop("data"))
        merged = {**c, **raw}
        merged["isActive"] = bool(merged.get("isActive"))
        connections.append(scrub(merged))

    combos = [
        scrub({**c, "models": json.loads(c["models"])})
        for c in from_db(
            "SELECT id, name, kind, models, createdAt, updatedAt FROM combos",
            ["id", "name", "kind", "models", "createdAt", "updatedAt"],
        )
    ]

    custom = [
        scrub(json.loads(r["value"]))
        for r in from_db(
            "SELECT value FROM kv WHERE scope='customModels' ORDER BY key", ["value"]
        )
    ]

    # `judge` lives in kv scope='modelAliases' as alias -> "provider/model".
    # Dropping it would make restore lose the name every combo's smartRouter
    # points at, and smart routing would fail open to plain fallback order.
    aliases = {
        r["key"]: json.loads(r["value"])
        for r in from_db(
            "SELECT key, value FROM kv WHERE scope='modelAliases' ORDER BY key",
            ["key", "value"],
        )
    }

    settings_row = list(from_db("SELECT data FROM settings", ["data"]))
    settings = scrub(json.loads(settings_row[0]["data"]) if settings_row else {})
    # `scrub` already drops the credential-named fields; these two are
    # server-side-only state that is not a credential but still has no place in
    # a portable snapshot.
    for drop in ("oidcConfigured", "hasPassword"):
        settings.pop(drop, None)

    return {
        "_exported": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "_note": (
            "9Router config backup. Secrets masked. Restore via API: "
            "nodes->POST /api/provider-nodes, conns->POST /api/providers, "
            "models->POST /api/models/custom, aliases->PUT /api/models/alias, "
            "combos->POST /api/combos (with real keys)."
        ),
        "combos": combos,
        "connections": connections,
        "nodes": nodes,
        "customModels": custom,
        "modelAliases": aliases,
        "settings": settings,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = cli_token()
    try:
        api("/api/health", token)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"gateway not reachable at {BASE}: {e}", file=sys.stderr)
        return 1

    doc = build(token)
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"

    leaks = SECRET_RE.findall(text)
    if leaks:
        print(f"SECRETS FOUND — aborting ({len(leaks)} match(es))", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"dry-run ok: {len(doc['combos'])} combos, {len(doc['connections'])} conns, "
              f"{len(doc['nodes'])} nodes, {len(doc['customModels'])} custom models")
        return 0

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}: {len(doc['combos'])} combos, {len(doc['connections'])} conns, "
          f"{len(doc['nodes'])} nodes, {len(doc['customModels'])} custom models")
    return 0


if __name__ == "__main__":
    sys.exit(main())
