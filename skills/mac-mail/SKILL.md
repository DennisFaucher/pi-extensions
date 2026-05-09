---
name: mac-mail
description: 8 tools for reading, searching, and extracting Mac Mail content
aliases:
  - mac-mail
  - mac mail
triggerKeywords:
  - What emails are in Mac Mail
  - What are my Exchange Emails
  - What are my Faucher Emails
  - What are my GMail emails
examples:
  - "What emails are in my Exchange Inbox?"
  - "What emails are in my Faucher Inbox?"
  - "What emails are in my GMail Inbox?"
category: utilities
---

# Indexing Emails
apple-mail-mcp index        # Build search index from disk
apple-mail-mcp status       # Show index statistics
apple-mail-mcp rebuild      # Force rebuild index

# Reading EMails
apple-mail-mcp read         # Read a single email (JSON output)
- Usage: apple-mail-mcp read MESSAGE-ID [ARGS]
- Read a single email with full content.
- MESSAGE-ID --message-id  [required]                                                                                              │
- ACCOUNT --account -a     Account name (speeds up lookup)                                                                         │
- MAILBOX --mailbox -m     Mailbox name (speeds up lookup)                                                                         │


# Searching Emails
Usage: apple-mail-mcp search QUERY [ARGS]

- Search emails using the FTS5 index.

- QUERY --query                         [required]                                                                                 │
- SCOPE --scope -s                      all, subject, sender, body, attachments [default: all]                                     │
- ACCOUNT --account -a                  Filter to specific account                                                                 │
- MAILBOX --mailbox -m                  Filter to specific mailbox                                                                 │
- LIMIT --limit -n                      Max results [default: 20]                                                                  │
- OFFSET --offset                       Skip first N results [default: 0]                                                          │
- BEFORE --before                       Before date (YYYY-MM-DD)                                                                   │
- AFTER --after                         After date (YYYY-MM-DD)                                                                    │
- HIGHLIGHT --highlight --no-highlight  Highlight matched terms [default: True]                                                    │


# List Email Accounts
apple-mail-mcp accounts     # List accounts (JSON output)

# List Email Mailboxes
Usage: apple-mail-mcp mailboxes [ARGS]
- List mailboxes for an account.
- ACCOUNT --account -a  Account name                                                                                                  │


# Usage 
```sh
/Users/faucherd/.local/bin/apple-mail-mcp
```

