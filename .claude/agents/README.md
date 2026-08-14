# Using these agents outside Jcode

The six agents in `.claude/agents/` are plain Markdown with YAML frontmatter,
the format Claude Code reads. They are committed to the repo, so they travel
with a clone rather than living in one machine's config.

## Where they work

| Tool | Works? | Notes |
|---|---|---|
| Claude Code CLI | yes | verified on 2.1.232 |
| Claude Code for VS Code | yes | same 2.1.232 engine, launches the same process |
| Claude Desktop | no | not an agent host, and not installed here |
| Jcode | yes | where they were written |

## Verified, not assumed

Asking the CLI to list its subagents **from this repo** returns all six:

```
backend, debugging, frontend, pipeline, testing, uxui
```

Running the same command from `C:\Users\hitul` returns the built-ins but **none
of the six**. That contrast is the actual proof that they are project-scoped:
they load because of the directory, not because of anything installed.

A real invocation was checked too, not just discovery. Asking the `backend`
agent what every UPDATE policy needs produced the correct answer with a citation
to `.claude/agents/backend.md:13`, so the file is genuinely being read as
instructions.

## Using them

In the CLI or the VS Code extension, open the repo and ask by name:

> use the backend agent to review this migration

Or non-interactively:

```
claude --print "Use the testing subagent to review scripts/foo.mjs"
```

## Claude Desktop

Not applicable. Claude Desktop is a chat client: it supports MCP servers but has
no `.claude/agents/` subagent system, and it is not installed on this machine.
The closest equivalent is opening the repo in VS Code with the Claude Code
extension.

## Scope

Because these are committed, anyone who clones the repo gets them. They are
deliberately specific to this codebase (RLS rules, the auth-gate policy, the
schema ordering discipline), so they are useful here and mostly noise elsewhere.
