#!/usr/bin/env python3
"""Search and parse Apple Mail .emlx files."""

import argparse
import email
import email.header
import fnmatch
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

BASE_DIR = Path("/Users/[userid]/Library/Mail/V10/[long-string]")


def parse_date_arg(value: str) -> date:
    value = value.strip().lower()
    today = date.today()
    if value == "today":
        return today
    if value == "yesterday":
        return today - timedelta(days=1)
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%d-%b-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    raise argparse.ArgumentTypeError(
        f"Unrecognized date format: '{value}'. Use YYYY-MM-DD, MM/DD/YYYY, 'today', or 'yesterday'."
    )


def wildcard_match(pattern: str, text: str) -> bool:
    if not text:
        return False
    return fnmatch.fnmatchcase(text.lower(), pattern.lower())


def decode_header_value(raw: str) -> str:
    if not raw:
        return ""
    parts = email.header.decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            try:
                decoded.append(part.decode(charset or "utf-8", errors="replace"))
            except (LookupError, UnicodeDecodeError):
                decoded.append(part.decode("latin-1", errors="replace"))
        else:
            decoded.append(part)
    return " ".join(decoded)


def extract_body(msg: email.message.Message) -> str:
    """Extract plain-text body, falling back to HTML stripped of tags."""
    plain_parts = []
    html_parts = []

    def collect(m: email.message.Message):
        ct = m.get_content_type()
        if m.is_multipart():
            for part in m.get_payload():
                collect(part)
        else:
            charset = m.get_content_charset() or "utf-8"
            try:
                raw = m.get_payload(decode=True)
                if raw is None:
                    return
                text = raw.decode(charset, errors="replace")
            except (LookupError, UnicodeDecodeError):
                raw = m.get_payload(decode=True) or b""
                text = raw.decode("latin-1", errors="replace")

            if ct == "text/plain":
                plain_parts.append(text)
            elif ct == "text/html":
                html_parts.append(text)

    collect(msg)
    if plain_parts:
        return "\n".join(plain_parts)
    if html_parts:
        combined = "\n".join(html_parts)
        return re.sub(r"<[^>]+>", " ", combined)
    return ""


def parse_emlx(path: Path) -> Optional[dict]:
    try:
        raw = path.read_bytes()
    except OSError:
        return None

    # First line is the byte count of the raw email portion
    newline_pos = raw.find(b"\n")
    if newline_pos == -1:
        return None
    try:
        byte_count = int(raw[:newline_pos].strip())
    except ValueError:
        return None

    email_bytes = raw[newline_pos + 1 : newline_pos + 1 + byte_count]

    try:
        msg = email.message_from_bytes(email_bytes)
    except Exception:
        return None

    subject = decode_header_value(msg.get("Subject", ""))
    from_addr = decode_header_value(msg.get("From", ""))
    to_addr = decode_header_value(msg.get("To", ""))
    date_str = msg.get("Date", "")
    body = extract_body(msg)

    # Parse the Date header; fall back to file mtime
    msg_date: Optional[date] = None
    if date_str:
        try:
            parsed_tuple = email.utils.parsedate_to_datetime(date_str)
            msg_date = parsed_tuple.date()
        except Exception:
            pass
    if msg_date is None:
        msg_date = date.fromtimestamp(path.stat().st_mtime)

    return {
        "path": str(path),
        "mailbox": path.parts[len(BASE_DIR.parts)],  # first component after base
        "date": msg_date,
        "date_str": msg_date.isoformat(),
        "subject": subject,
        "from": from_addr,
        "to": to_addr,
        "body": body,
    }


def collect_emlx_files(
    mailboxes: list[str],
    startdate: Optional[date] = None,
    enddate: Optional[date] = None,
) -> list[Path]:
    files = []
    for mb in mailboxes:
        mb_path = BASE_DIR / mb
        if not mb_path.is_dir():
            print(f"Warning: mailbox not found: {mb}", file=sys.stderr)
            continue

        # Build a `find` command; let the OS filter by mtime before Python sees any paths.
        # A 1-day buffer on each side covers timezone offsets between the Date header
        # and the local file mtime.
        cmd = ["find", str(mb_path), "-name", "*.emlx"]
        if startdate:
            cutoff = (startdate - timedelta(days=1)).strftime("%Y-%m-%d")
            cmd += ["-newermt", cutoff]
        if enddate:
            cutoff = (enddate + timedelta(days=2)).strftime("%Y-%m-%d")
            cmd += ["!", "-newermt", cutoff]

        result = subprocess.run(cmd, capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if line:
                files.append(Path(line))
    return files


def list_mailboxes() -> list[str]:
    return sorted(p.name for p in BASE_DIR.iterdir() if p.is_dir() and p.name.endswith(".mbox"))


def string_match(pattern: str, text: str) -> bool:
    """Substring match when no wildcards; fnmatch otherwise."""
    pat = pattern.lower()
    if "*" in pat or "?" in pat:
        return wildcard_match(pat, text)
    return pat in text.lower()


def matches(record: dict, args: argparse.Namespace) -> bool:
    if args.startdate and record["date"] < args.startdate:
        return False
    if args.enddate and record["date"] > args.enddate:
        return False
    if args.subject and not string_match(args.subject, record["subject"]):
        return False
    if getattr(args, "from") and not string_match(getattr(args, "from"), record["from"]):
        return False
    if args.to and not string_match(args.to, record["to"]):
        return False
    if args.body and not string_match(args.body, record["body"]):
        return False
    return True


def format_text(results: list[dict]) -> str:
    lines = []
    for r in results:
        lines.append("=" * 72)
        lines.append(f"Mailbox : {r['mailbox']}")
        lines.append(f"Date    : {r['date_str']}")
        lines.append(f"From    : {r['from']}")
        lines.append(f"To      : {r['to']}")
        lines.append(f"Subject : {r['subject']}")
        lines.append(f"File    : {r['path']}")
        body_preview = r["body"][:500].strip().replace("\n", " ")
        if len(r["body"]) > 500:
            body_preview += "…"
        lines.append(f"Body    : {body_preview}")
    if results:
        lines.append("=" * 72)
    lines.append(f"\n{len(results)} message(s) found.")
    return "\n".join(lines)


def format_json(results: list[dict]) -> str:
    serialisable = []
    for r in results:
        row = dict(r)
        row.pop("date")  # keep date_str only
        serialisable.append(row)
    return json.dumps(serialisable, indent=2, ensure_ascii=False)


def format_markdown(results: list[dict]) -> str:
    lines = [f"# Mail Search Results\n", f"**{len(results)} message(s) found.**\n"]
    for i, r in enumerate(results, 1):
        lines.append(f"---\n")
        lines.append(f"### {i}. {r['subject'] or '(no subject)'}\n")
        lines.append(f"| Field | Value |")
        lines.append(f"|-------|-------|")
        lines.append(f"| **Date** | {r['date_str']} |")
        lines.append(f"| **From** | {r['from']} |")
        lines.append(f"| **To** | {r['to']} |")
        lines.append(f"| **Mailbox** | {r['mailbox']} |")
        body_preview = r["body"][:300].strip().replace("\n", " ").replace("|", "\\|")
        if len(r["body"]) > 300:
            body_preview += "…"
        lines.append(f"\n**Body:** {body_preview}\n")
    return "\n".join(lines)


def main():
    all_mailboxes = list_mailboxes()

    parser = argparse.ArgumentParser(
        description="Search Apple Mail .emlx files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Available mailboxes:\n  " + "\n  ".join(all_mailboxes),
    )
    parser.add_argument(
        "--mailbox",
        metavar="NAME",
        nargs="+",
        help="One or more .mbox directory names (default: all). Wildcards supported.",
    )
    parser.add_argument("--startdate", metavar="DATE", type=parse_date_arg, help="Earliest email date (inclusive).")
    parser.add_argument("--enddate", metavar="DATE", type=parse_date_arg, help="Latest email date (inclusive).")
    parser.add_argument("--subject", metavar="PATTERN", help="Subject filter (case-insensitive, wildcards OK).")
    parser.add_argument("--from", metavar="PATTERN", help="From-address filter (case-insensitive, wildcards OK).")
    parser.add_argument("--to", metavar="PATTERN", help="To-address filter (case-insensitive, wildcards OK).")
    parser.add_argument("--body", metavar="PATTERN", help="Body filter (case-insensitive, wildcards OK).")
    parser.add_argument(
        "--output",
        choices=["text", "json", "markdown"],
        default="text",
        help="Output format (default: text).",
    )
    parser.add_argument("--list-mailboxes", action="store_true", help="List available mailboxes and exit.")

    args = parser.parse_args()

    if args.list_mailboxes:
        print("\n".join(all_mailboxes))
        return

    # Resolve mailbox selection (support wildcards)
    if args.mailbox:
        selected = []
        for pattern in args.mailbox:
            matched = [mb for mb in all_mailboxes if fnmatch.fnmatchcase(mb.lower(), pattern.lower())]
            if not matched:
                # Try without .mbox suffix
                matched = [mb for mb in all_mailboxes if fnmatch.fnmatchcase(mb.lower(), (pattern + ".mbox").lower())]
            if not matched:
                print(f"Warning: no mailbox matched '{pattern}'", file=sys.stderr)
            selected.extend(matched)
        # Deduplicate while preserving order
        seen = set()
        mailboxes = [mb for mb in selected if not (mb in seen or seen.add(mb))]
    else:
        mailboxes = all_mailboxes

    if not mailboxes:
        print("No mailboxes to search.", file=sys.stderr)
        sys.exit(1)

    print(f"Searching {len(mailboxes)} mailbox(es)…", file=sys.stderr)
    files = collect_emlx_files(mailboxes, args.startdate, args.enddate)
    print(f"Found {len(files)} .emlx file(s). Filtering…", file=sys.stderr)

    results = []
    for path in files:
        record = parse_emlx(path)
        if record is None:
            continue
        if matches(record, args):
            results.append(record)

    results.sort(key=lambda r: r["date"])

    if args.output == "json":
        print(format_json(results))
    elif args.output == "markdown":
        print(format_markdown(results))
    else:
        print(format_text(results))


if __name__ == "__main__":
    main()
