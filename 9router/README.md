# 9Router Config Backup

Auto-exported snapshot of the 9Router gateway (VPS `9router.service`, port 20128, v0.5.65).
This is the **personal instance** (data dir `/home/personal/9router-data/`). The profill
instance (port 20129) is separate and NOT included.

## Files

- `config-export.json` — nodes, connections, custom models, combos, settings.
  API keys / tokens are **masked** (e.g. `sk_ab…12cd`) — real keys never leave the VPS.

## Restore (disaster recovery)

Recreate everything through the API (real keys required — re-enter them manually):

```bash
# login cookie first (see 9router-admin skill), then:
POST /api/provider-nodes       # each node (name, prefix, apiType: chat, baseUrl, type: openai-compatible)
POST /api/providers            # each connection {provider: <nodeId>, apiKey: <REAL KEY>, name}
POST /api/models/custom        # each custom model {providerAlias, id, type: llm, name}
POST /api/combos               # each combo {name, models: [...], kind: llm}
```

## Refresh

Regenerate from the live gateway whenever provider/model/combo topology changes:

```bash
python3 /home/personal/dotfiles/9router/export.sh   # (or run export_9router.py equivalent)
cd /home/personal/dotfiles && git add 9router hermes && git commit -m "backup 9router config" && git push
```

## Notes

- Shared-key (rotating) models: keys change often. Always re-export after a key rotation so
  the masked tails in the backup stay meaningful for cross-checking.
- Combos referenced by name from Hermes profile configs (`profill-general`, `shiteru-*`, etc.).
  Keep combo names stable — renaming breaks profile `model.default` references.
