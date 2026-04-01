/**
 * Gmail Extension for Pi
 *
 * This extension allows reading Gmail emails using your email address and app password.
 *
 * Setup:
 * 1. Go to your Google Account security settings
 * 2. Enable 2-Step Verification if not already enabled
 * 3. Generate an App Password: https://myaccount.google.com/apppasswords
 * 4. The app password will be a 16-digit code (e.g., "abcd efgh ijkl mnop")
 *
 * Usage:
 * - Ask the AI to "read my Gmail" or "check my emails"
 * - Specify a folder: "read inbox", "read sent", "read starred"
 * - Ask for specific emails: "read emails from [sender]"
 *
 * The extension will prompt you for your email and app password on first use.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ImapFlow } from "imapflow";

// Stored credentials for reuse across tool calls
let storedEmail: string | null = null;
let storedAppPassword: string | null = null;

// Gmail IMAP folder mapping
const FOLDER_MAP: Record<string, string> = {
  inbox: "INBOX",
  sent: "[Gmail]/Sent Mail",
  starred: "[Gmail]/Starred",
  drafts: "[Gmail]/Drafts",
  spam: "[Gmail]/Spam",
  trash: "[Gmail]/Trash",
  important: "[Gmail]/Important",
  all: "[Gmail]/All Mail",
};

/**
 * Create an authenticated IMAP client connected to Gmail
 */
async function createImapClient(email: string, appPassword: string): Promise<ImapFlow> {
  // Strip spaces from app password (Google displays it as "xxxx xxxx xxxx xxxx")
  const cleanPassword = appPassword.replace(/\s+/g, "");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: email,
      pass: cleanPassword,
    },
    logger: false,
  });

  await client.connect();
  return client;
}

/**
 * Fetch emails from Gmail via IMAP
 */
async function fetchEmails(
  folder: string,
  limit: number = 10,
  query?: string
): Promise<Array<{ id: string; snippet: string; from: string; subject: string; date: string }>> {
  if (!storedEmail || !storedAppPassword) {
    throw new Error("Not authenticated. Please run /gmail-auth first.");
  }

  const mailbox = FOLDER_MAP[folder.toLowerCase()] ?? "INBOX";
  const client = await createImapClient(storedEmail, storedAppPassword);

  try {
    const emails: Array<{ id: string; snippet: string; from: string; subject: string; date: string }> = [];

    // mailboxOpen returns info including .exists (total message count)
    const info = await client.mailboxOpen(mailbox, { readOnly: true });
    const total: number = (info as any).exists ?? 0;

    if (total === 0) {
      return emails;
    }

    let seqRange: string;

    if (query) {
      // Use IMAP search for filtered queries; fall back to sequence range if empty
      const matched = await client.search({ body: query });
      if (matched.length === 0) return emails;
      const recent = matched.slice(-limit);
      seqRange = recent.join(",");
    } else {
      // Fetch the last `limit` messages by sequence number (most recent first)
      const start = Math.max(1, total - limit + 1);
      seqRange = `${start}:${total}`;
    }

    for await (const msg of client.fetch(seqRange, { envelope: true, bodyStructure: true })) {
      const envelope = msg.envelope;
      const from = envelope.from?.[0]
        ? `${envelope.from[0].name ?? ""} <${envelope.from[0].address ?? ""}>`.trim()
        : "Unknown";
      const subject = envelope.subject ?? "No Subject";
      const date = envelope.date?.toISOString() ?? "Unknown date";
      const uid = String((msg as any).uid ?? msg.seq);

      emails.unshift({ id: uid, from, subject, date, snippet: "" });
    }

    return emails;
  } finally {
    await client.logout();
  }
}

/**
 * Read a specific email by UID
 */
async function readEmail(
  mailbox: string,
  uid: string
): Promise<{ from: string; to: string; subject: string; body: string; date: string }> {
  if (!storedEmail || !storedAppPassword) {
    throw new Error("Not authenticated. Please run /gmail-auth first.");
  }

  const client = await createImapClient(storedEmail, storedAppPassword);

  try {
    await client.mailboxOpen(mailbox, { readOnly: true });

    const msg = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });

    const envelope = (msg as any).envelope;
    const from = envelope.from?.[0]
      ? `${envelope.from[0].name ?? ""} <${envelope.from[0].address ?? ""}>`.trim()
      : "Unknown";
    const to = envelope.to?.[0]
      ? `${envelope.to[0].name ?? ""} <${envelope.to[0].address ?? ""}>`.trim()
      : "Unknown";
    const subject = envelope.subject ?? "No Subject";
    const date = envelope.date?.toISOString() ?? "Unknown date";

    const rawSource = (msg as any).source;
    const body = Buffer.isBuffer(rawSource) ? rawSource.toString("utf-8") : String(rawSource ?? "");

    return { from, to, subject, date, body };
  } finally {
    await client.logout();
  }
}

export default function (pi: ExtensionAPI) {
  // Register a tool for listing emails
  pi.registerTool({
    name: "gmail_list_emails",
    label: "Gmail List Emails",
    description: "List emails from Gmail inbox or other folders",
    promptSnippet: "List emails from Gmail (inbox, sent, starred, etc.)",
    parameters: Type.Object({
      folder: Type.Optional(
        Type.Enum({
          inbox: "inbox",
          sent: "sent",
          starred: "starred",
          drafts: "drafts",
          spam: "spam",
          trash: "trash",
          important: "important",
          all: "all",
        } as const)
      ),
      limit: Type.Optional(Type.Integer({ description: "Maximum number of emails to fetch", default: 10 })),
      query: Type.Optional(Type.String({ description: "Optional search term to filter emails by body text" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (!storedEmail || !storedAppPassword) {
          const email = await ctx.ui.input("Gmail Login", "Enter your Gmail address:");
          if (!email) {
            return {
              content: [{ type: "text", text: "Cancelled: No email address provided." }],
              isError: true,
            };
          }

          const appPassword = await ctx.ui.input("Gmail App Password", "Enter your 16-digit Gmail app password:");
          if (!appPassword) {
            return {
              content: [{ type: "text", text: "Cancelled: No app password provided." }],
              isError: true,
            };
          }

          storedEmail = email;
          storedAppPassword = appPassword;
        }

        const folder = params.folder || "inbox";
        const limit = params.limit || 10;
        const query = params.query || undefined;

        const emails = await fetchEmails(folder, limit, query);

        if (emails.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No emails found in ${folder}${query ? ` matching "${query}"` : ""}.`,
              },
            ],
          };
        }

        const formattedEmails = emails
          .map(
            (e, i) =>
              `${i + 1}. [UID: ${e.id}]\n   From: ${e.from}\n   Subject: ${e.subject}\n   Date: ${e.date}\n   Snippet: ${e.snippet.substring(0, 100)}...`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${emails.length} email(s) in ${folder}:\n\n${formattedEmails}`,
            },
          ],
          details: { emails },
        };
      } catch (error) {
        // Clear credentials on auth failure so user can retry
        if (error instanceof Error && error.message.includes("Authentication")) {
          storedEmail = null;
          storedAppPassword = null;
        }
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [{ type: "text", text: `Error fetching emails: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  });

  // Register a tool for reading a specific email
  pi.registerTool({
    name: "gmail_read_email",
    label: "Gmail Read Email",
    description: "Read a specific Gmail email by UID",
    promptSnippet: "Read a specific Gmail email by UID",
    parameters: Type.Object({
      messageId: Type.String({ description: "The Gmail message UID to read" }),
      folder: Type.Optional(Type.String({ description: "The folder containing the email (default: INBOX)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (!storedEmail || !storedAppPassword) {
          const email = await ctx.ui.input("Gmail Login", "Enter your Gmail address:");
          if (!email) {
            return {
              content: [{ type: "text", text: "Cancelled: No email address provided." }],
              isError: true,
            };
          }

          const appPassword = await ctx.ui.input("Gmail App Password", "Enter your 16-digit Gmail app password:");
          if (!appPassword) {
            return {
              content: [{ type: "text", text: "Cancelled: No app password provided." }],
              isError: true,
            };
          }

          storedEmail = email;
          storedAppPassword = appPassword;
        }

        const folderKey = (params.folder ?? "inbox").toLowerCase();
        const mailbox = FOLDER_MAP[folderKey] ?? params.folder ?? "INBOX";
        const emailData = await readEmail(mailbox, params.messageId);

        const content = `From: ${emailData.from}
To: ${emailData.to}
Subject: ${emailData.subject}
Date: ${emailData.date}

---

${emailData.body}`;

        return {
          content: [{ type: "text", text: content }],
          details: emailData,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [{ type: "text", text: `Error reading email: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  });

  // Register a command for manual authentication
  pi.registerCommand("gmail-auth", {
    description: "Authenticate with Gmail using email and app password",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/gmail-auth requires interactive mode", "error");
        return;
      }

      try {
        const email = await ctx.ui.input("Gmail Login", "Enter your Gmail address:");
        if (!email) {
          ctx.ui.notify("Cancelled: No email address provided.", "error");
          return;
        }

        const appPassword = await ctx.ui.input("Gmail App Password", "Enter your 16-digit Gmail app password:");
        if (!appPassword) {
          ctx.ui.notify("Cancelled: No app password provided.", "error");
          return;
        }

        // Test the connection
        const client = await createImapClient(email, appPassword);
        await client.logout();

        storedEmail = email;
        storedAppPassword = appPassword;
        ctx.ui.notify("Gmail authentication successful!", "success");

        // Test fetching one email
        try {
          const testEmails = await fetchEmails("inbox", 1);
          if (testEmails.length > 0) {
            ctx.ui.notify(`Connected! Found email(s) in inbox.`, "info");
          } else {
            ctx.ui.notify("Connected! Your inbox is empty.", "info");
          }
        } catch (testError) {
          ctx.ui.notify(
            "Connected, but could not fetch emails: " +
              (testError instanceof Error ? testError.message : "Unknown error"),
            "warning"
          );
        }
      } catch (error) {
        storedEmail = null;
        storedAppPassword = null;
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
        ctx.ui.notify(`Authentication failed: ${errorMsg}`, "error");
      }
    },
  });

  // Register a command for listing emails
  pi.registerCommand("gmail-list", {
    description: "List emails from Gmail",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/gmail-list requires interactive mode", "error");
        return;
      }

      try {
        const folder = await ctx.ui.input("Folder", "Enter folder (inbox, sent, starred, drafts, spam, trash, important, all):");
        if (!folder) {
          ctx.ui.notify("Cancelled: No folder specified.", "error");
          return;
        }

        const limitInput = await ctx.ui.input("Limit", "Enter number of emails (default: 10):");
        const limit = limitInput ? parseInt(limitInput) : 10;

        if (!storedEmail || !storedAppPassword) {
          ctx.ui.notify("Not authenticated. Run /gmail-auth first.", "error");
          return;
        }

        const emails = await fetchEmails(folder, limit);

        if (emails.length === 0) {
          ctx.ui.notify(`No emails found in ${folder}.`, "info");
          return;
        }

        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
          const lines: string[] = [];
          lines.push("");
          lines.push(theme.fg("accent", theme.bold(` Emails from ${folder.toUpperCase()}`)) + "");
          lines.push("");

          for (let i = 0; i < emails.length; i++) {
            const e = emails[i];
            const snippet = e.snippet.substring(0, 80);
            lines.push(theme.fg("muted", `${i + 1}.`) + " " + theme.fg("text", e.from));
            lines.push("   " + theme.fg("accent", `Subject: ${e.subject}`));
            lines.push("   " + theme.fg("dim", `Date: ${e.date}`));
            lines.push("   " + theme.fg("dim", `Snippet: ${snippet}...`));
            lines.push("");
          }

          lines.push(theme.fg("dim", "Press Escape to close"));
          lines.push("");

          return {
            render(width: number) {
              return lines.map((line) => line.substring(0, width));
            },
            invalidate() {},
            handleInput(data: string) {
              if (data === "escape" || data === "ctrl+c") {
                done();
              }
            },
          };
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
        ctx.ui.notify(`Error listing emails: ${errorMsg}`, "error");
      }
    },
  });

  // Notify when extension loads
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Gmail extension loaded! Use /gmail-auth to authenticate.", "info");
  });
}
