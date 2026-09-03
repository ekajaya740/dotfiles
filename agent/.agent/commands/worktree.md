---
name: worktree
description: "Create a new profill worktree for a feature branch. Run from profill-monorepo-beta."
---

# worktree

Run from `../profill-monorepo-beta`. Creates an isolated worktree for a new feature.

## Steps

1. **Read the issue** — `gh issue view <NUM> --repo profill-link/<repo> --json title,body,labels,number`
2. **Create worktree** — `git worktree add -b fix/mr-N-slug ../profill-monorepo-fix-mr-N-slug beta-master`
3. **Install** — `cd ../profill-monorepo-fix-mr-N-slug && bun install`
4. **Copy env** — copy `.env`, `apps/backend/.env`, `apps/backend/.dev.vars`, `apps/admin-fe/.env`, `apps/admin-fe/.dev.vars` from `../profill-monorepo-beta/`
5. **Create PLAN.md** — write from issue context, commit it
6. **Verify** — `bun run check && bun run build`
7. **Report** — print worktree path and branch name
