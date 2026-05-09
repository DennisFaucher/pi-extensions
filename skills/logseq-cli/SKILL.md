---
name: logseq-cli
description: logseq-cli is a local CLI for file-based Logseq graphs.  It works directly on local graph folders and is intended for local shells, scripts, and coding agents. It does not depend on Logseq Desktop, and it does not expose MCP, HTTP, daemon, or any other network interface.
aliases:
  - logseq-cli
  - logseq
triggerKeywords:
  - Logseq journals
  - Logseq notes
  - Logseq ToDos
examples:
  - "What are my logseq journals for today"
  - "What logseq notes include #LinuxNotes"
  - "What open ToDos do I have in logseq?"
---
### IMPORTANT!!
Always pass "--graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq" to all commands
Also, whenever you go to run the "logseq-cli" command, use the full run string of "uv --directory /Users/faucherd/Documents/Resilio/MBP-Personal/Programming/Python/logseq-cli/ run logseq-cli"

### Implemented MVP
The current CLI implements these commands:

graph detect
graph use
graph stats
page list
page read
page create
page append
page append-under
journal list
journal ensure
journal read
journal append
journal summarize
links backlinks
links outgoing
capture quick
capture project
capture task
decisions list
lessons list
cards build decision
cards build lesson
cards build weekly
cards build project
cards build topic
cards build tag
recall topic
timeline topic
summarize daily
summarize weekly
summarize project
summarize topic
search links
search tags
search text
tasks list
All MVP commands support --json.

Supported Graphs
Supported graph type:

file-based Logseq graphs
Expected layout:

GRAPH_ROOT/
├── journals/
├── pages/
├── assets/        # optional
└── logseq/        # optional, but `logseq/config.edn` also marks a graph root
Supported document formats:

Markdown .md
Org-mode .org with limited read support

Usage
Detect a graph:

logseq-cli graph detect --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq
Set the default graph for later commands:

logseq-cli graph use --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq
Show graph stats:

logseq-cli graph stats --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
List pages:

logseq-cli page list --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Read a page:

logseq-cli page read "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Create a page:

logseq-cli page create "Weekly Plan" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --text "- TODO Review goals" --json
Append to a page:

logseq-cli page append "Weekly Plan" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --text "- Captured next action" --json
Append under a heading:

logseq-cli page append-under "Weekly Plan" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --heading "Today" --text "- Captured next action" --json
Read a journal:

logseq-cli journal read --date 2026-03-29 --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
List journals:

logseq-cli journal list --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --limit 7 --json
Ensure a journal exists:

logseq-cli journal ensure --date 2026-03-29 --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Summarize a journal:

logseq-cli journal summarize --date 2026-03-29 --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Append to a journal:

logseq-cli journal append --date 2026-03-29 --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --text "Investigated parser edge case"
Dry-run an append:

logseq-cli journal append --date 2026-03-29 --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --text "test append" --dry-run --json
Search text:

logseq-cli search text "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --scope pages,journals --json
Search using an alias group:

logseq-cli search text "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Search page refs:

logseq-cli search links "Project Notes" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Search tags:

logseq-cli search tags "ops" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Build local release artifacts:

./scripts/release.sh build
Suppress human-readable output:

logseq-cli graph detect --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --quiet
List tasks:

logseq-cli tasks list --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --state todo,doing --json
Show backlinks:

logseq-cli links backlinks "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Show outgoing links:

logseq-cli links outgoing "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Quick capture to a journal:

logseq-cli capture quick --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --today --text "Captured item" --json
Capture a project note:

logseq-cli capture project "Project Alpha" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --text "Investigated issue" --json
Capture a task:

logseq-cli capture task --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --today --text "Follow up with team" --project "Project Alpha" --json
Summarize a day:

logseq-cli summarize daily --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --date 2026-03-29 --json
Summarize a week:

logseq-cli summarize weekly --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --date 2026-03-29 --json
Summarize a project:

logseq-cli summarize project "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Summarize a topic:

logseq-cli summarize topic "ops" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Recall a topic across pages and journals:

logseq-cli recall topic "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --since 2026-01-01 --json
Show a topic timeline across journals:

logseq-cli timeline topic "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --since 2026-01-01 --json
Build a topic knowledge card:

logseq-cli cards build topic "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Build a tag knowledge card:

logseq-cli cards build tag "ops" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Build a project knowledge card:

logseq-cli cards build project "OpenClaw" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
List decision records and extracted reasons:

logseq-cli decisions list "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --since 2026-01-01 --json
List lessons, pitfalls, and best practices:

logseq-cli lessons list "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --since 2026-01-01 --json
Build a decision card:

logseq-cli cards build decision "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Build a lesson card:

logseq-cli cards build lesson "MBB" --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --json
Build a weekly card:

logseq-cli cards build weekly --graph /Users/faucherd/Documents/Resilio/Logseq/ResilioLogseq --date 2026-03-29 --json
Graph Resolution
Graph discovery order:

--graph
~/.config/logseq-cli/config.toml
current directory upward auto-discovery
Optional config example:

default_graph = "/Users/you/Documents/Logseq"

[aliases]
MBB = ["Management by blocks", "management-by-blocks"]
OpenClaw = ["Open Claw", "open-claw"]
After graph use, commands can run outside the graph directory as long as no explicit --graph overrides it.

Alias groups are expanded automatically in:

search text
search links
search tags
summarize topic
recall topic
timeline topic
cards build topic
cards build tag
decisions list
lessons list
JSON Contract
Successful responses use this envelope:

{
  "ok": true,
  "command": "page read",
  "graph_root": "/path/to/graph",
  "data": {},
  "warnings": [],
  "errors": []
}
Failure responses keep the same top-level fields:

{
  "ok": false,
  "command": "page read",
  "graph_root": "/path/to/graph",
  "data": null,
  "warnings": [],
  "errors": [
    {
      "code": "PAGE_NOT_FOUND",
      "message": "Page 'Missing Page' not found"
    }
  ]
}
Stable exit codes:

0 success
1 general failure
2 invalid arguments
3 graph not found
4 page or journal not found
5 write conflict
6 parse failure
Output Modes
--json emits the stable machine-readable envelope.
--raw is available on read commands that can print document content directly.
--quiet suppresses normal human-readable stdout output but does not disable writes or change exit codes.
Current Behavior
Page resolution tries exact filename, case-insensitive filename, normalized filename, then heading-title matching.
Page creation is conservative: it refuses to overwrite or create pages that collide by normalized name or heading title.
Page append performs end-of-file append only; it does not rewrite or target headings.
Page append-under appends within the matched section and stops before the next same-or-higher-level heading.
Search is plain text substring search with optional --scope and --limit.
Search links matches parsed [[Page]] references.
Search tags matches parsed Markdown and Org tags.
Alias groups from config.toml expand query terms across supported search, recall, card, decision, and lesson commands.
Task extraction recognizes common Logseq-style TODO states from Markdown bullets and Org headings.
Journal list returns journals in descending date order.
Journal ensure creates an empty journal file only when missing.
Journal append writes a single bullet block and supports --dry-run.
Journal summarize is rule-based and reports block counts, task states, page refs, and tags.
Link inspection is based on parsed [[Page]] references in page and journal content.
Capture quick is a thin wrapper around safe journal append.
Capture project appends a bullet to a project page and can create the page only with --create-page.
Capture task appends a TODO entry to a journal and can include a project page reference.
Summaries are rule-based aggregates over parsed journal content, not free-form generated text.
Project summaries combine the project page, references to that page, related tasks, and outgoing page refs.
Topic summaries aggregate blocks and tasks by case-insensitive text, tag, or page-ref matches.
Topic recall builds a compact evidence pack with top matches, source counts, related tags, related page refs, and optional journal date filtering.
Topic timeline focuses on journal history and returns chronologically ordered entries for a topic or tag.
Knowledge cards compress recall output into summary, key points, open tasks, and evidence that Claude Code can reuse directly.
Project cards combine the project page, related references, open tasks, related links, and compact evidence for project-oriented Q&A.
Decision cards compress extracted decision records and reason snippets into an answer-ready decision brief.
Lesson cards compress extracted lessons and takeaways into an answer-ready best-practices brief.
Weekly cards compress a 7-day journal window into key points, open tasks, related refs, and evidence blocks.
Decision extraction uses local heuristics to pull likely decisions plus inline or child-block reason snippets across pages and journals.
Lesson extraction uses local heuristics to pull best practices, pitfalls, notes-to-self, and experience snippets across pages and journals.
Known Limitations
The CLI targets file-based graphs only.
Org-mode support is read-oriented and intentionally partial.
Search is lexical; there is no semantic search or date filtering.
Write support is still intentionally narrow: page create, page append, page append-under, and journal append.

# Usage 
```bash
uv --directory /Users/faucherd/Documents/Resilio/MBP-Personal/Programming/Python/logseq-cli/ run logseq-cli
```

