<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Use the knowledge graph first

This project is mapped into a graphify knowledge graph committed at
`graphify-out/` (2,758 nodes / 4,291 edges / 227 named communities, built from
tree-sitter AST so it is deterministic and costs nothing to rebuild).

**Before grepping or opening files to answer a question about this codebase,
query the graph.** It is faster and it returns the connections a grep cannot:

```
graphify query "how does permission checking work on the team lead page?"
graphify explain "getLiveTeamLeadBoard()"      # one symbol and its neighbours
graphify affected "secondsToHours()"           # what breaks if I change this
graphify path "A" "B" --undirected              # how two things connect
graphify god-nodes --top 15                     # the architectural hubs
```

Then fall back to reading files for the specific lines you need to change.
`graphify-out/GRAPH_REPORT.md` is for broad architecture review.

Keeping it current is automatic: a `post-commit` hook rebuilds the graph after
any commit that touches code (AST only, no API key, no cost), and a git merge
driver union-merges `graph.json` so parallel commits never conflict. If you
ever need it by hand: `graphify update .`

Two things about the setup that are deliberate and should not be "fixed":

- `.graphifyignore` excludes the five vendored agent-skill trees (`.claude/`,
  `.agents/`, `.github/skills/`, `.v3code/`, `agent/skills/`). Without that the
  god-node ranking is dominated by the bundled "impeccable" skill's own helpers
  and the graph describes the tooling instead of this product.
  `.github/workflows/` is deliberately NOT excluded: the CI is ours.
- `graphifyy[sql]` must be installed or the 17 SQL files (including
  `supabase/schema.sql`, i.e. the entire RLS model) parse to nothing, silently.

`graph.json`, `GRAPH_REPORT.md` and `manifest.json` are committed on purpose so
every session starts from the same map; `graph.html`, `cache/` and the
per-machine pointers are gitignored.
