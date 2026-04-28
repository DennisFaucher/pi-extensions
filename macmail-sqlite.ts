/**
 * Mac Mail SQLite Extension for Pi
 *
 * Reads emails directly from macOS Mail's SQLite database and .emlx files.
 * Much faster than AppleScript — no IPC overhead, no Mail app required.
 *
 * Requirements:
 *   - Full Disk Access granted to the app running pi
 *     (System Settings → Privacy & Security → Full Disk Access)
 *
 * Tools registered:
 *   - mail_db_list_mailboxes  List all mailboxes with unread/total counts
 *   - mail_db_list_emails     List recent emails from a mailbox
 *   - mail_db_read_email      Read the full body of an email by message ID
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);
const HOME = process.env.HOME!;

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** Auto-detect the highest Mail version directory (V10, V9, …) */
function mailVersionDir(): string {
	const mailRoot = join(HOME, "Library", "Mail");
	const ver = readdirSync(mailRoot)
		.filter((d) => /^V\d+$/.test(d))
		.sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)))[0];
	if (!ver) throw new Error("No Mail version directory found under ~/Library/Mail");
	return join(mailRoot, ver);
}

function dbPath(): string {
	return join(mailVersionDir(), "MailData", "Envelope Index");
}

async function queryDb<T = Record<string, unknown>>(sql: string): Promise<T[]> {
	const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath(), sql], {
		maxBuffer: 50 * 1024 * 1024,
	});
	const text = stdout.trim();
	if (!text) return [];
	return JSON.parse(text) as T[];
}

// ---------------------------------------------------------------------------
// emlx body reading
// ---------------------------------------------------------------------------

/** Extract the account GUID from a mailbox URL like ews://GUID/Inbox */
function guidFromUrl(url: string): string | null {
	const m = url.match(/^(?:ews|imap):\/\/([^/]+)\//);
	return m ? m[1] : null;
}

/** Locate the .emlx file for a given message ROWID within an account directory.
 *  Returns { path, partial } — partial=true means Mail hasn't downloaded the full body. */
async function findEmlxFile(
	accountGuid: string,
	rowid: number,
): Promise<{ path: string; partial: boolean } | null> {
	const accountDir = join(mailVersionDir(), accountGuid);
	try {
		// Search for both full and partial emlx in one pass
		const { stdout } = await execFileAsync(
			"find",
			[accountDir, "-name", `${rowid}.emlx`, "-o", "-name", `${rowid}.partial.emlx`],
			{ maxBuffer: 1024 * 1024 },
		);
		const paths = stdout.trim().split("\n").filter(Boolean);
		if (!paths.length) return null;
		// Prefer the full .emlx over .partial.emlx
		const full = paths.find((p) => p.endsWith(`${rowid}.emlx`));
		const partial = paths.find((p) => p.endsWith(".partial.emlx"));
		if (full) return { path: full, partial: false };
		if (partial) return { path: partial, partial: true };
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// MIME parser
// ---------------------------------------------------------------------------

/** Decode RFC 2047 encoded-word tokens like =?utf-8?B?...?= or =?utf-8?Q?...?= */
function decodeEncodedWords(s: string): string {
	return s.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, encoded) => {
		try {
			const buf =
				encoding.toUpperCase() === "B"
					? Buffer.from(encoded, "base64")
					: Buffer.from(decodeQP(encoded.replace(/_/g, " ")), "binary");
			return buf.toString(charset.toLowerCase().replace("-", "") as BufferEncoding ?? "utf8");
		} catch {
			return encoded;
		}
	});
}

function decodeQP(s: string): string {
	return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
		String.fromCharCode(parseInt(h, 16)),
	);
}

function decodeB64(s: string): string {
	try {
		return Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf-8");
	} catch {
		return s;
	}
}

function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

interface ParsedHeaders {
	headers: Map<string, string>;
	rest: string;
}

function parseHeaders(text: string): ParsedHeaders {
	const headers = new Map<string, string>();
	const lines = text.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line === "") break;
		// Header continuation
		if (/^\s/.test(line)) {
			const last = [...headers.keys()].pop();
			if (last) headers.set(last, (headers.get(last) ?? "") + " " + line.trim());
		} else {
			const colon = line.indexOf(":");
			if (colon > 0) {
				headers.set(line.slice(0, colon).toLowerCase().trim(), line.slice(colon + 1).trim());
			}
		}
		i++;
	}
	return { headers, rest: lines.slice(i + 1).join("\n") };
}

function extractBoundary(contentType: string): string | null {
	const m = contentType.match(/boundary=(?:"([^"]+)"|(\S+))/i);
	return m ? (m[1] ?? m[2]) : null;
}

function decodeBody(body: string, encoding: string): string {
	const enc = encoding.toLowerCase().replace(/\s/g, "");
	if (enc === "base64") return decodeB64(body);
	if (enc === "quoted-printable") return decodeQP(body);
	return body;
}

/** Recursively extract the best plain-text representation from a MIME blob */
function extractText(mime: string): string {
	const { headers, rest } = parseHeaders(mime);
	const ct = headers.get("content-type") ?? "text/plain";
	const enc = headers.get("content-transfer-encoding") ?? "7bit";

	if (ct.startsWith("text/plain")) {
		return decodeBody(rest, enc).trim();
	}

	if (ct.startsWith("text/html")) {
		return stripHtml(decodeBody(rest, enc));
	}

	if (ct.startsWith("multipart/")) {
		const boundary = extractBoundary(ct);
		if (!boundary) return rest.trim();
		// Split on boundary markers; prefer text/plain over text/html
		const parts = rest.split(new RegExp(`--${escapeRe(boundary)}(?:--)?`)).slice(1);
		let htmlFallback = "";
		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed || trimmed === "--") continue;
			const pct = parseHeaders(trimmed).headers.get("content-type") ?? "";
			if (pct.startsWith("text/plain")) {
				const t = extractText(trimmed);
				if (t) return t;
			}
			if (pct.startsWith("text/html") && !htmlFallback) {
				htmlFallback = extractText(trimmed);
			}
			// Recurse into nested multipart
			if (pct.startsWith("multipart/")) {
				const t = extractText(trimmed);
				if (t) return t;
			}
		}
		return htmlFallback;
	}

	return "";
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Read and parse an emlx file, returning headers + plain-text body */
function readEmlx(filePath: string): { from: string; to: string; subject: string; date: string; body: string } {
	const raw = readFileSync(filePath, "latin1");
	// Line 1 is the byte count; the email starts on line 2
	const nlIdx = raw.indexOf("\n");
	const emailRaw = raw.slice(nlIdx + 1);
	// Trim trailing plist metadata (starts with <?xml)
	const plistIdx = emailRaw.indexOf("<?xml");
	const email = plistIdx > 0 ? emailRaw.slice(0, plistIdx) : emailRaw;

	const { headers } = parseHeaders(email);
	const body = extractText(email);

	return {
		from: decodeEncodedWords(headers.get("from") ?? ""),
		to: decodeEncodedWords(headers.get("to") ?? ""),
		subject: decodeEncodedWords(headers.get("subject") ?? ""),
		date: headers.get("date") ?? "",
		body: body || "(body not available — message may be partially downloaded)",
	};
}

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

interface MailboxRow {
	ROWID: number;
	url: string;
	total_count: number;
	unread_count: number;
}

interface MessageRow {
	ROWID: number;
	subject: string;
	address: string;
	comment: string;
	date_received: number;
	read: number;
	summary: string;
	mailbox_url: string;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function macMailSqliteExtension(pi: ExtensionAPI) {

	// ── List Mailboxes ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "mail_db_list_mailboxes",
		label: "Mail DB: List Mailboxes",
		description:
			"List all mailboxes in macOS Mail with their unread and total message counts. " +
			"Use this first to find the mailbox_id needed for mail_db_list_emails. " +
			"Requires Full Disk Access.",
		promptSnippet: "List all Mail mailboxes with counts",
		parameters: Type.Object({
			filter: Type.Optional(
				Type.String({
					description:
						"Optional text to filter mailbox URLs (e.g. 'ews' for Exchange, 'imap', 'Inbox', 'Sent')",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macmail-sqlite", "Querying mailboxes…");
				const filter = (params as any).filter as string | undefined;
				const whereClause = filter
					? `WHERE url LIKE '%${filter.replace(/'/g, "''")}%'`
					: "";
				const rows = await queryDb<MailboxRow>(
					`SELECT ROWID, url, total_count, unread_count
					 FROM mailboxes ${whereClause}
					 ORDER BY url`,
				);
				ctx.ui.setStatus("macmail-sqlite", "");

				if (!rows.length) {
					return { content: [{ type: "text", text: "No mailboxes found." }] };
				}

				const lines = rows.map(
					(r) =>
						`[id:${r.ROWID}] ${decodeURIComponent(r.url)}` +
						`  (${r.unread_count} unread / ${r.total_count} total)`,
				);
				return {
					content: [{ type: "text", text: `${rows.length} mailboxes:\n\n` + lines.join("\n") }],
					details: { mailboxes: rows },
				};
			} catch (err) {
				ctx.ui.setStatus("macmail-sqlite", "");
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	});

	// ── List Emails ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "mail_db_list_emails",
		label: "Mail DB: List Emails",
		description:
			"List recent emails from a mailbox using macOS Mail's SQLite database. " +
			"Use mail_db_list_mailboxes first to get the mailbox_id. " +
			"Returns subject, sender, date, read status, and a body preview.",
		promptSnippet: "List emails from a Mail mailbox by ID",
		parameters: Type.Object({
			mailbox_id: Type.Integer({
				description: "Mailbox ROWID from mail_db_list_mailboxes (e.g. 57 for Exchange Inbox)",
			}),
			limit: Type.Optional(
				Type.Integer({ description: "Max number of emails to return (default: 20)" }),
			),
			unread_only: Type.Optional(
				Type.Boolean({ description: "Only return unread emails (default: false)" }),
			),
			search: Type.Optional(
				Type.String({ description: "Filter by subject or sender address (case-insensitive)" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macmail-sqlite", "Querying emails…");
				const p = params as any;
				const mailboxId = p.mailbox_id as number;
				const limit = (p.limit as number | undefined) ?? 20;
				const unreadOnly = (p.unread_only as boolean | undefined) ?? false;
				const search = p.search as string | undefined;

				const unreadClause = unreadOnly ? "AND m.read = 0" : "";
				const searchClause = search
					? `AND (s.subject LIKE '%${search.replace(/'/g, "''")}%'
					       OR a.address LIKE '%${search.replace(/'/g, "''")}%'
					       OR a.comment LIKE '%${search.replace(/'/g, "''")}%')`
					: "";

				const rows = await queryDb<MessageRow>(`
					SELECT m.ROWID, s.subject, a.address, a.comment,
					       m.date_received, m.read,
					       COALESCE(sm.summary, '') AS summary,
					       mb.url AS mailbox_url
					FROM messages m
					JOIN subjects s  ON m.subject = s.ROWID
					JOIN addresses a ON m.sender  = a.ROWID
					JOIN mailboxes mb ON m.mailbox = mb.ROWID
					LEFT JOIN summaries sm ON m.summary = sm.ROWID
					WHERE m.mailbox = ${mailboxId}
					  AND m.deleted = 0
					  ${unreadClause}
					  ${searchClause}
					ORDER BY m.date_received DESC
					LIMIT ${limit}
				`);
				ctx.ui.setStatus("macmail-sqlite", "");

				if (!rows.length) {
					return {
						content: [{ type: "text", text: "No emails found matching your criteria." }],
					};
				}

				const lines = rows.map((r, i) => {
					const sender = r.comment ? `${r.comment} <${r.address}>` : r.address;
					const date = new Date(r.date_received * 1000).toLocaleString();
					const status = r.read ? "read" : "UNREAD";
					const preview = r.summary ? `\n   Preview: ${r.summary.slice(0, 120)}…` : "";
					return `${i + 1}. [id:${r.ROWID}] [${status}] ${r.subject}\n   From: ${sender}\n   Date: ${date}${preview}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `${rows.length} email(s):\n\n` + lines.join("\n\n"),
						},
					],
					details: { emails: rows },
				};
			} catch (err) {
				ctx.ui.setStatus("macmail-sqlite", "");
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	});

	// ── Read Email ──────────────────────────────────────────────────────────

	pi.registerTool({
		name: "mail_db_read_email",
		label: "Mail DB: Read Email",
		description:
			"Read the full content of an email by its message ID (ROWID). " +
			"Use mail_db_list_emails first to find the message ID. " +
			"Reads directly from the .emlx file on disk.",
		promptSnippet: "Read full email body by message ID",
		parameters: Type.Object({
			message_id: Type.Integer({
				description: "Message ROWID from mail_db_list_emails",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macmail-sqlite", "Reading email…");
				const rowid = (params as any).message_id as number;

				// Look up the mailbox URL to find the account GUID
				const rows = await queryDb<{ url: string; subject: string; address: string; comment: string; summary: string }>(`
					SELECT mb.url, s.subject, a.address, a.comment,
					       COALESCE(sm.summary, '') AS summary
					FROM messages m
					JOIN mailboxes mb ON m.mailbox = mb.ROWID
					JOIN subjects s   ON m.subject = s.ROWID
					JOIN addresses a  ON m.sender  = a.ROWID
					LEFT JOIN summaries sm ON m.summary = sm.ROWID
					WHERE m.ROWID = ${rowid}
					LIMIT 1
				`);

				if (!rows.length) {
					ctx.ui.setStatus("macmail-sqlite", "");
					return {
						content: [{ type: "text", text: `No message found with id ${rowid}.` }],
						isError: true,
					};
				}

				const meta = rows[0];
				const guid = guidFromUrl(meta.url);

				let emailContent: ReturnType<typeof readEmlx> | null = null;

				if (guid) {
					ctx.ui.setStatus("macmail-sqlite", "Locating .emlx file…");
					const emlxFile = await findEmlxFile(guid, rowid);
					if (emlxFile && !emlxFile.partial) {
						try {
							emailContent = readEmlx(emlxFile.path);
						} catch (e) {
							// Fall through to summary fallback
						}
					}
					// partial.emlx = headers only; body not yet downloaded by Mail
				}

				ctx.ui.setStatus("macmail-sqlite", "");

				const sender = meta.comment ? `${meta.comment} <${meta.address}>` : meta.address;
				let text: string;

				if (emailContent) {
					text =
						`From: ${emailContent.from || sender}\n` +
						`To: ${emailContent.to}\n` +
						`Subject: ${emailContent.subject || meta.subject}\n` +
						`Date: ${emailContent.date}\n` +
						`\n---\n\n${emailContent.body}`;
				} else {
					// Fallback: use summary from DB
					text =
						`From: ${sender}\n` +
						`Subject: ${meta.subject}\n` +
						`\n---\n\n${meta.summary || "(body not available)"}`;
				}

				return { content: [{ type: "text", text }], details: emailContent ?? meta };
			} catch (err) {
				ctx.ui.setStatus("macmail-sqlite", "");
				return {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	});
}
