/**
 * Microsoft Teams Extension for Pi
 *
 * Reads chats and messages from Microsoft Teams web (https://teams.microsoft.com/v2/)
 * running in Google Chrome — no credentials required.
 * Piggybacks on the Teams session already open in your Chrome browser.
 *
 * Setup:
 *   - Google Chrome must be open with a tab at teams.microsoft.com/v2/
 *   - Grant Automation permission when macOS prompts: allow Terminal/pi to control Chrome
 *
 * Tools registered:
 *   - teams_list_chats:        List all chats/channels visible in the Teams sidebar
 *   - teams_read_current_chat: Read messages from the currently open chat
 *   - teams_open_chat:         Navigate to a specific chat by name, then read with teams_read_current_chat
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const MSG_SEP = "<<MSG>>";
const FIELD_SEP = "<<F>>";
const CHAT_SEP = "<<CHAT>>";

// Execute JavaScript in the Chrome tab that has teams.microsoft.com open.
// JS is written to a temp file to avoid AppleScript string-escaping issues.
async function runInTeams(js: string): Promise<string> {
	const tmpFile = join(tmpdir(), `pi_teams_${Date.now()}.js`);
	try {
		await writeFile(tmpFile, js, "utf-8");

		const script = `
tell application "Google Chrome"
  set teamsTab to missing value
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "teams.microsoft.com" then
        set teamsTab to t
        exit repeat
      end if
    end repeat
    if teamsTab is not missing value then exit repeat
  end repeat
  if teamsTab is missing value then
    return "ERROR: No Teams tab found. Open https://teams.microsoft.com/v2/ in Chrome."
  end if
  set jsCode to do shell script "cat " & quoted form of "${tmpFile}"
  set result to execute teamsTab javascript jsCode
  return result as string
end tell`;

		const { stdout } = await execFileAsync("osascript", ["-e", script], {
			maxBuffer: 10 * 1024 * 1024,
		});
		return stdout.trimEnd();
	} finally {
		await unlink(tmpFile).catch(() => {});
	}
}

interface Chat {
	name: string;
	id: string;
	type: string;
	preview: string;
}

interface Message {
	author: string;
	content: string;
	timestamp: string;
}

async function listChats(): Promise<Chat[]> {
	// Selectors confirmed via DOM probe on 2026-04-04:
	//   [role="treeitem"] with data-fui-tree-item-value ending in @thread.v2 / @thread.tacv2
	//   Types: OneGQL_GroupChatConversation, OneGQL_ChannelConversation, OneGQL_SpacesConversation
	const js = `(function() {
  var SEP = "${FIELD_SEP}", MSG = "${MSG_SEP}";
  var items = Array.from(document.querySelectorAll('[role="treeitem"]'));
  return items
    .filter(function(item) {
      var val = item.getAttribute('data-fui-tree-item-value') || '';
      var last = val.split('/').pop() || '';
      return last.indexOf('@thread') !== -1 || last.indexOf('SpacesConversation') !== -1;
    })
    .map(function(item) {
      var val = item.getAttribute('data-fui-tree-item-value') || '';
      var last = val.split('/').pop() || '';
      var pipe = last.indexOf('|');
      var type = pipe >= 0 ? last.slice(0, pipe) : last;
      var id   = pipe >= 0 ? last.slice(pipe + 1) : '';
      var lines = item.innerText.split('\\n').filter(function(l) { return l.trim(); });
      var name    = lines[0] || '';
      var preview = lines[1] || '';
      return name + SEP + id + SEP + type + SEP + preview + MSG;
    })
    .join('');
})()`;

	const raw = await runInTeams(js);
	if (raw.startsWith("ERROR:")) throw new Error(raw.slice(7).trim());

	return raw
		.split(MSG_SEP)
		.filter(Boolean)
		.map((chunk) => {
			const [name, id, type, preview] = chunk.split(FIELD_SEP);
			return {
				name:    name    ?? "",
				id:      id      ?? "",
				type:    (type   ?? "").replace("OneGQL_", "").replace("Conversation", ""),
				preview: preview ?? "",
			};
		});
}

async function readCurrentChat(limit: number): Promise<{ chatName: string; messages: Message[] }> {
	// Selectors confirmed via DOM probe on 2026-04-04:
	//   [data-tid="chat-title"]           — current chat name
	//   [data-tid="chat-pane-item"]       — one per message
	//   [data-tid="message-author-name"]  — sender display name
	//   [data-tid="chat-pane-message"]    — message body text
	//   time[datetime]                    — ISO 8601 timestamp
	const js = `(function() {
  var SEP = "${FIELD_SEP}", MSG = "${MSG_SEP}", CHAT = "${CHAT_SEP}";
  var chatTitle = (document.querySelector('[data-tid="chat-title"]') || {innerText:''}).innerText.trim();
  var items = Array.from(document.querySelectorAll('[data-tid="chat-pane-item"]'));
  var msgs = items.slice(-${limit}).map(function(item) {
    var author  = (item.querySelector('[data-tid="message-author-name"]') || {innerText:''}).innerText.trim();
    var msgEl   = item.querySelector('[data-tid="chat-pane-message"]');
    var content = msgEl ? msgEl.innerText.trim() : '';
    var timeEl  = item.querySelector('time');
    var ts      = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';
    if (!author && !content) return '';
    return author + SEP + content + SEP + ts + MSG;
  }).filter(Boolean).join('');
  return chatTitle + CHAT + msgs;
})()`;

	const raw = await runInTeams(js);
	if (raw.startsWith("ERROR:")) throw new Error(raw.slice(7).trim());

	const chatIdx = raw.indexOf(CHAT_SEP);
	const chatName = chatIdx >= 0 ? raw.slice(0, chatIdx) : "";
	const msgsPart = chatIdx >= 0 ? raw.slice(chatIdx + CHAT_SEP.length) : "";

	const messages = msgsPart
		.split(MSG_SEP)
		.filter(Boolean)
		.map((chunk) => {
			const [author, content, timestamp] = chunk.split(FIELD_SEP);
			return {
				author:    author    ?? "",
				content:   content   ?? "",
				timestamp: timestamp ?? "",
			};
		});

	return { chatName, messages };
}

async function openChat(name: string): Promise<void> {
	// Escape the name for embedding inside a JS double-quoted string literal
	const safeName = name
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n");

	const js = `(function() {
  var target = "${safeName}";
  var items = Array.from(document.querySelectorAll('[role="treeitem"]'));
  for (var i = 0; i < items.length; i++) {
    var itemName = (items[i].innerText.split('\\n')[0] || '').trim();
    if (itemName === target) {
      items[i].click();
      return 'OK';
    }
  }
  return 'ERROR: Chat not found: ' + target;
})()`;

	const result = await runInTeams(js);
	if (result.startsWith("ERROR:")) throw new Error(result.slice(7).trim());
}

export default function macTeamsExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "teams_list_chats",
		label: "Teams: List Chats",
		description:
			"List all chats and channels visible in the Microsoft Teams sidebar. " +
			"Chrome must be open with a tab at teams.microsoft.com. " +
			"Use this to find exact chat names before calling teams_open_chat.",
		promptSnippet: "List my Teams chats",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			try {
				const chats = await listChats();
				if (chats.length === 0) {
					return { content: [{ type: "text", text: "No chats found in Teams sidebar." }] };
				}
				const text =
					`Teams chats/channels (${chats.length}):\n\n` +
					chats
						.map((c, i) => `${i + 1}. ${c.name}  [${c.type}]${c.preview ? `\n   ${c.preview}` : ""}`)
						.join("\n");
				return { content: [{ type: "text", text }], details: { chats } };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "teams_read_current_chat",
		label: "Teams: Read Current Chat",
		description:
			"Read messages from the chat currently open in Microsoft Teams. " +
			"Returns the most recent messages. Use teams_open_chat first to switch to a specific conversation.",
		promptSnippet: "Read current Teams chat messages",
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Integer({ description: "Max number of recent messages to return (default: 20)" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macteams", "Reading Teams messages...");
				const limit = ((params as any).limit as number | undefined) ?? 20;
				const { chatName, messages } = await readCurrentChat(limit);
				ctx.ui.setStatus("macteams", "");

				if (messages.length === 0) {
					return { content: [{ type: "text", text: `No messages found in "${chatName}".` }] };
				}

				const lines = messages.map((m) => {
					const date = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
					return `[${date}] ${m.author}:\n${m.content}`;
				});
				const text = `Chat: ${chatName}\n${"─".repeat(40)}\n\n` + lines.join("\n\n");
				return { content: [{ type: "text", text }], details: { chatName, messages } };
			} catch (err) {
				ctx.ui.setStatus("macteams", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "teams_open_chat",
		label: "Teams: Open Chat",
		description:
			"Navigate to a specific chat or channel in Microsoft Teams by name. " +
			"Use teams_list_chats to find exact chat names. " +
			"After opening, call teams_read_current_chat to read its messages.",
		promptSnippet: "Open a Teams chat by name",
		parameters: Type.Object({
			chat_name: Type.String({
				description: "Exact name of the chat or channel to open (use teams_list_chats to find names)",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("macteams", "Opening Teams chat...");
				const name = (params as any).chat_name as string;
				await openChat(name);
				// Give Teams React time to render the messages before the caller reads them
				await new Promise((resolve) => setTimeout(resolve, 1500));
				ctx.ui.setStatus("macteams", "");
				return {
					content: [{
						type: "text",
						text: `Opened chat: "${name}". Call teams_read_current_chat to read messages.`,
					}],
				};
			} catch (err) {
				ctx.ui.setStatus("macteams", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});
}
