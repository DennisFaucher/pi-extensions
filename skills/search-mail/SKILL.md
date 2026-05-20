---
name: search-mail
description: Search and retrieve emails stored as `.emlx` files in an Apple Mail V10 mailstore. Use this skill whenever the user asks about their email — finding messages, summarizing threads, checking who sent something, reviewing recent correspondence, or answering questions about email content.
---

# Skill: Search Apple Mail (search_mail.py)

## Purpose
Search and retrieve emails stored as `.emlx` files in an Apple Mail V10 mailstore. Use this skill whenever the user asks about their email — finding messages, summarizing threads, checking who sent something, reviewing recent correspondence, or answering questions about email content.

## Invocation
```
python3 /Users/faucherd/Documents/Resilio/MBP-Personal/Programming/Python/Search_Mac_Mail/search_mail.py [OPTIONS]
```

All filters are optional and combinable. Results are sorted by date ascending.

---

## Parameters

| Flag | Argument | Description |
|------|----------|-------------|
| `--mailbox` | `NAME [NAME ...]` | One or more mailbox names (see list below). Supports wildcards. Omit to search all mailboxes. |
| `--startdate` | `DATE` | Earliest email date, inclusive. |
| `--enddate` | `DATE` | Latest email date, inclusive. |
| `--subject` | `PATTERN` | Filter on email subject. |
| `--from` | `PATTERN` | Filter on sender address or display name. |
| `--to` | `PATTERN` | Filter on recipient address or display name. |
| `--body` | `PATTERN` | Filter on email body text. |
| `--output` | `text` \| `json` \| `markdown` | Output format. Default: `text`. Use `json` for structured processing. |
| `--list-mailboxes` | *(flag)* | Print all available mailbox names and exit. |

### DATE formats accepted
- `today` — current calendar date
- `yesterday` — one day prior
- `YYYY-MM-DD` — e.g. `2026-05-01`
- `MM/DD/YYYY` — e.g. `05/01/2026`
- `MM-DD-YYYY` — e.g. `05-01-2026`
- `DD-Mon-YYYY` — e.g. `01-May-2026`
- `Month DD, YYYY` — e.g. `May 1, 2026`

### PATTERN matching rules
- **No wildcards** (`*` or `?`): case-insensitive **substring** match. `wwt.com` matches `"John Doe <john@wwt.com>"`.
- **With wildcards**: case-insensitive `fnmatch` against the full field. `*@wwt.com` matches any wwt.com address. `?` matches any single character.
- All PATTERN filters apply to the decoded, human-readable value (display name + address for From/To; decoded subject text; plain-text body).

---

## Available Mailboxes
```
Archive.mbox
Boxer.mbox
Conduent DL.mbox
Conversation History.mbox
Deleted Items.mbox
Drafts.mbox
Inbox.mbox
Journal.mbox
Junk Email.mbox
Notes.mbox
Outbox.mbox
RSS Subscriptions.mbox
Sent Items.mbox
Sync Issues.mbox
Tasks.mbox
WWT_Archive.mbox
```
Use `--list-mailboxes` to get the current list at runtime.

---

## Output formats

### text (default)
Human-readable blocks separated by `===` dividers. Body is truncated to **500 characters**. Progress messages go to stderr.
```
========================================================================
Mailbox : Inbox.mbox
Date    : 2026-05-20
From    : Jane Smith <jane@example.com>
To      : dennis.faucher@wwt.com
Subject : Q2 Review
File    : /path/to/message.emlx
Body    : Please find attached...
========================================================================
3 message(s) found.
```

### json
Array of objects, one per message. Body is **full, untruncated**. Pipe stderr to `/dev/null` for clean JSON.
```json
[
  {
    "path": "/path/to/message.emlx",
    "mailbox": "Inbox.mbox",
    "date_str": "2026-05-20",
    "subject": "Q2 Review",
    "from": "Jane Smith <jane@example.com>",
    "to": "dennis.faucher@wwt.com",
    "body": "Please find attached..."
  }
]
```

### markdown
Formatted table per message with body preview truncated to **300 characters**. Suitable for display in chat interfaces.

---

## Examples

```bash
# All emails received today
python3 search_mail.py --startdate today

# Inbox emails from the past week
python3 search_mail.py --mailbox Inbox.mbox --startdate 2026-05-13 --enddate today

# Find emails from anyone at wwt.com (substring match)
python3 search_mail.py --from wwt.com

# Find emails about invoices sent to a specific domain
python3 search_mail.py --subject invoice --to "*@rtx.com"

# Full-text body search across all mailboxes
python3 search_mail.py --body "quarterly review"

# Structured JSON output for downstream processing (stderr suppressed)
python3 search_mail.py --mailbox Inbox.mbox --from nvidia --output json 2>/dev/null

# Search across multiple specific mailboxes
python3 search_mail.py --mailbox Inbox.mbox "Sent Items.mbox" --startdate 2026-05-01

# Wildcard mailbox selection
python3 search_mail.py --mailbox "WWT*" --subject "*renewal*"
```

---

## Agent guidance

- **Prefer `--output json`** when you need to process results programmatically (count, summarize, extract fields). Suppress stderr with `2>/dev/null`.
- **Use `--output markdown`** when presenting results directly to a user in a chat interface.
- **Combine filters** freely — all active filters are ANDed together.
- When the user asks about recent email without specifying a date, default to `--startdate today` or `--startdate yesterday` to keep result sets manageable.
- When the user gives a vague sender like "the email from NVIDIA", use a substring `--from nvidia` rather than an exact address.
- When results are large, re-run with tighter filters rather than truncating the output yourself — the script's own filtering is faster.
- The `File` path in results is the canonical `.emlx` location; you can read it directly for full message content not shown in the preview.
- `.partial.emlx` files are partially downloaded messages — content may be incomplete.
