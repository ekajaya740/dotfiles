---
description: Show jev-router's recent subagent routing decisions
---

Show the operator what the `jev-router` hook has been deciding. Run:

```bash
tail -n 20 ~/.claude/jev-router.jsonl 2>/dev/null || echo "no routing decisions yet"
```

Then summarise, from the JSON lines: how many calls were rewritten to
`Explore`/`haiku` (`action: "explore/haiku"`), how many were observed only
(`action: "advise"`), and how many passed through (`action: "pass"`). Mention
that setting `JEV_ROUTER_MODE=advise` turns rewriting off while keeping the pick
visible here.
