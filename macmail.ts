/**
 * Mac Mail Extension for Pi
 *
 * Reads emails directly from the macOS Mail app via AppleScript — no credentials required.
 * Works with any account configured in Mail (Exchange, Gmail, iCloud, etc.).
 *
 * Setup:
 *   - macOS Mail must be installed (it will launch automatically if not running)
 *   - Grant Automation permission when macOS prompts: allow Terminal/pi to control Mail
 *
 * Tools registered:
 *   - mail_list_accounts:  List all accounts configured in Mail
 *   - mail_list_emails:    List recent emails from a mailbox
 *   - mail_read_email:     Read the full content of a specific email
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MSG_SEP = "<<MSG>>";
const FIELD_SEP = "<<F>>";

// Escape a value for safe injection into an AppleScript string literal
function esc(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runScript(script: string): Promise<string> {
	const { stdout } = await execFileAsync("osascript", ["-e", script], {
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout.trimEnd();
}

// Build AppleScript to resolve an account + mailbox, then execute `body`
// Injects: theAccount (account ref), theMailbox (mailbox ref)
function withMailbox(accountName: string | undefined, mailboxName: string, body: string): string {
	const findMailbox = `
		set theMailbox to missing value
		repeat with mb in every mailbox of theAccount
			if name of mb is "${esc(mailboxName)}" then
				set theMailbox to mb
				exit repeat
			end if
		end repeat
		if theMailbox is missing value then
			return "ERROR: Mailbox \\"${esc(mailboxName)}\\" not found in account \\"" & (name of theAccount) & "\\""
		end if
	`;

	if (accountName) {
		return `
tell application "Mail"
	set theAccount to missing value
	repeat with acct in every account
		if name of acct is "${esc(accountName)}" then
			set theAccount to acct
			exit repeat
		end if
	end repeat
	if theAccount is missing value then
		return "ERROR: Account \\"${esc(accountName)}\\" not found"
	end if
	${findMailbox}
	${body}
end tell`;
	} else {
		// No account specified — find first account that has the mailbox
		return `
tell application "Mail"
	set theAccount to missing value
	set theMailbox to missing value
	repeat with acct in every account
		repeat with mb in every mailbox of acct
			if name of mb is "${esc(mailboxName)}" then
				set theAccount to acct
				set theMailbox to mb
				exit repeat
			end if
		end repeat
		if theMailbox is not missing value then exit repeat
	end repeat
	if theMailbox is missing value then
		return "ERROR: No account has a mailbox named \\"${esc(mailboxName)}\\""
	end if
	${body}
end tell`;
	}
}

interface EmailSummary {
	index: number;
	subject: string;
	sender: string;
	date: string;
	read: boolean;
}

interface EmailDetail extends EmailSummary {
	to: string;
	body: string;
	account: string;
	mailbox: string;
}

async function listAccounts(): Promise<string[]> {
	const script = `
tell application "Mail"
	set out to ""
	repeat with acct in every account
		set out to out & (name of acct) & linefeed
	end repeat
	return out
end tell`;
	const raw = await runScript(script);
	return raw.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function listEmails(
	accountName: string | undefined,
	mailboxName: string,
	limit: number,
	unreadOnly: boolean,
): Promise<EmailSummary[]> {
	const filterClause = unreadOnly ? "if read status of msg is false then" : "if true then";

	const body = `
	set out to ""
	set collected to 0
	set msgList to every message of theMailbox
	repeat with msg in msgList
		${filterClause}
			set msgSubject to subject of msg
			if msgSubject is missing value then set msgSubject to "(no subject)"
			set msgSender to sender of msg
			if msgSender is missing value then set msgSender to ""
			set msgDate to (date received of msg) as string
			set msgRead to read status of msg
			set msgIdx to id of msg
			set out to out & msgIdx & "${FIELD_SEP}" & msgSubject & "${FIELD_SEP}" & msgSender & "${FIELD_SEP}" & msgDate & "${FIELD_SEP}" & msgRead & "${MSG_SEP}"
			set collected to collected + 1
			if collected >= ${limit} then exit repeat
		end if
	end repeat
	return out`;

	const raw = await runScript(withMailbox(accountName, mailboxName, body));

	if (raw.startsWith("ERROR:")) throw new Error(raw.slice(7).trim());

	return raw
		.split(MSG_SEP)
		.filter(Boolean)
		.map((chunk, i) => {
			const [idx, subject, sender, date, read] = chunk.split(FIELD_SEP);
			return {
				index: i + 1,
				subject: subject ?? "(no subject)",
				sender: sender ?? "",
				date: date ?? "",
				read: read?.trim() === "true",
			};
		});
}

async function readEmail(
	accountName: string | undefined,
	mailboxName: string,
	messageIndex: number,
): Promise<EmailDetail> {
	// AppleScript message index is 1-based; messages are in newest-first order
	const body = `
	set msgList to every message of theMailbox
	if ${messageIndex} > (count of msgList) then
		return "ERROR: Message index ${messageIndex} out of range"
	end if
	set msg to item ${messageIndex} of msgList
	set msgSubject to subject of msg
	if msgSubject is missing value then set msgSubject to "(no subject)"
	set msgSender to sender of msg
	if msgSender is missing value then set msgSender to ""
	set msgTo to to recipients of msg
	set toStr to ""
	repeat with r in msgTo
		set toStr to toStr & (address of r) & ", "
	end repeat
	set msgDate to (date received of msg) as string
	set msgRead to read status of msg
	set msgBody to content of msg
	if msgBody is missing value then set msgBody to ""
	set acctName to name of theAccount
	return msgSubject & "${FIELD_SEP}" & msgSender & "${FIELD_SEP}" & toStr & "${FIELD_SEP}" & msgDate & "${FIELD_SEP}" & msgRead & "${FIELD_SEP}" & acctName & "${FIELD_SEP}" & msgBody`;

	const raw = await runScript(withMailbox(accountName, mailboxName, body));

	if (raw.startsWith("ERROR:")) throw new Error(raw.slice(7).trim());

	const parts = raw.split(FIELD_SEP);
	const [subject, sender, to, date, read, account, ...bodyParts] = parts;
	return {
		index: messageIndex,
		subject: subject ?? "(no subject)",
		sender: sender ?? "",
		to: to?.replace(/,\s*$/, "") ?? "",
		date: date ?? "",
		read: read?.trim() === "true",
		account: account ?? "",
		mailbox: mailboxName,
		body: bodyParts.join(FIELD_SEP),
	};
}

export default function macMailExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mail_list_accounts",
		label: "Mail: List Accounts",
		description:
			"List all email accounts configured in the macOS Mail app. Use this to discover account names before reading emails.",
		promptSnippet: "List email accounts in Mac Mail",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			try {
				const accounts = await listAccounts();
				if (accounts.length === 0) {
					return { content: [{ type: "text", text: "No accounts found in Mail." }] };
				}
				const text = `Mail accounts (${accounts.length}):\n` + accounts.map((a, i) => `  ${i + 1}. ${a}`).join("\n");
				return { content: [{ type: "text", text }], details: { accounts } };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "mail_list_emails",
		label: "Mail: List Emails",
		description:
			"List recent emails from a mailbox in the macOS Mail app. Works with any account (Exchange, Gmail, iCloud, etc.). " +
			"Use mail_list_accounts first to get the exact account name. " +
			"Leave account blank to search across all accounts.",
		promptSnippet: "List emails from Mac Mail inbox",
		parameters: Type.Object({
			account: Type.Optional(
				Type.String({ description: "Account name (e.g. 'Exchange'). Leave blank to search all accounts." }),
			),
			mailbox: Type.Optional(
				Type.String({ description: "Mailbox name (default: 'Inbox')" }),
			),
			limit: Type.Optional(
				Type.Integer({ description: "Max number of emails to return (default: 10)" }),
			),
			unread_only: Type.Optional(
				Type.Boolean({ description: "Only return unread emails (default: false)" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macmail", "Reading Mac Mail...");
				const account = (params as any).account as string | undefined;
				const mailbox = ((params as any).mailbox as string | undefined) ?? "Inbox";
				const limit = ((params as any).limit as number | undefined) ?? 10;
				const unreadOnly = ((params as any).unread_only as boolean | undefined) ?? false;

				const emails = await listEmails(account, mailbox, limit, unreadOnly);
				ctx.ui.setStatus("macmail", "");

				if (emails.length === 0) {
					const qualifier = unreadOnly ? "unread " : "";
					return {
						content: [{ type: "text", text: `No ${qualifier}emails found in ${mailbox}.` }],
					};
				}

				const lines = emails.map(
					(e) =>
						`${e.index}. [${e.read ? "read" : "UNREAD"}] ${e.subject}\n   From: ${e.sender}\n   Date: ${e.date}`,
				);
				const text = `${emails.length} email(s) in ${mailbox}:\n\n` + lines.join("\n\n");
				return { content: [{ type: "text", text }], details: { emails } };
			} catch (err) {
				ctx.ui.setStatus("macmail", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "mail_read_email",
		label: "Mail: Read Email",
		description:
			"Read the full content of an email from macOS Mail by its position in the mailbox. " +
			"Use mail_list_emails first to find the message index.",
		promptSnippet: "Read a specific email from Mac Mail",
		parameters: Type.Object({
			message_index: Type.Integer({
				description: "1-based index of the message as returned by mail_list_emails",
			}),
			account: Type.Optional(
				Type.String({ description: "Account name. Leave blank to search all accounts." }),
			),
			mailbox: Type.Optional(
				Type.String({ description: "Mailbox name (default: 'Inbox')" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macmail", "Reading email...");
				const account = (params as any).account as string | undefined;
				const mailbox = ((params as any).mailbox as string | undefined) ?? "Inbox";
				const index = (params as any).message_index as number;

				const email = await readEmail(account, mailbox, index);
				ctx.ui.setStatus("macmail", "");

				const text =
					`Account: ${email.account}\n` +
					`From: ${email.sender}\n` +
					`To: ${email.to}\n` +
					`Subject: ${email.subject}\n` +
					`Date: ${email.date}\n` +
					`Read: ${email.read}\n` +
					`\n---\n\n${email.body}`;

				return { content: [{ type: "text", text }], details: email };
			} catch (err) {
				ctx.ui.setStatus("macmail", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});
}
