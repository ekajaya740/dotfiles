---
name: clean-merge-beta-master-worktree
description: "Commit all changes, merge current worktree branch to beta-master, remove the worktree. Run from inside a profill worktree."
---

# clean-merge-beta-master-worktree

Run from inside a profill worktree (`../profill-monorepo-*`). Executes the full end-to-end merge flow.

## Steps

1. **Detect worktree** — verify we're in a profill worktree (not beta-master, not master)
2. **Remove PLAN.md** — `git rm PLAN.md && git commit -m "chore: remove PLAN.md (mr#N)"`
3. **Push branch** — `git push origin HEAD`
4. **Merge to beta-master** — `cd ../profill-monorepo-beta && git pull --ff-only && git merge --ff-only ../profill-monorepo-fix-mr-N-slug && git push origin beta-master`
5. **Remove worktree** — `git worktree remove ../profill-monorepo-fix-mr-N-slug && git branch -d fix/mr-N-slug`
6. **Report** — print summary of what was merged and removed
