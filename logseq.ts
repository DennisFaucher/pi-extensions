/**
 * Logseq Extension
 *
 * Provides tools to search and retrieve content from a local Logseq graph
 * via the Logseq HTTP API server (http://localhost:12315).
 *
 * Setup:
 *   1. In Logseq, go to Settings → Features → Enable HTTP APIs server
 *   2. Set an authorization token in Logseq settings
 *   3. export LOGSEQ_API_TOKEN=your-token-here
 *
 * Tools registered:
 *   - logseq_search:         Case-sensitive full-text search across all blocks
 *   - logseq_search_tasks:   Search TODO/DONE tasks, optionally filtered by keyword or tag
 *   - logseq_list_pages:     List all pages (optionally filter journals only)
 *   - logseq_get_page:       Get the content of a specific page
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const LOGSEQ_API_URL = "http://localhost:12315/api";

// --- Types ---

interface BlockEntity {
	id?: number;
	uuid: string;
	content: string;
	marker?: string;
	"pre-block?"?: boolean;
	"collapsed?"?: boolean;
	properties?: Record<string, unknown>;
	children?: BlockEntity[];
	page?: { id?: number; name?: string; originalName?: string; journalDay?: number; "journal?"?: boolean; "journal-day"?: number };
	refs?: Array<{ id: number }>;
}

interface PageEntity {
	id: number;
	uuid: string;
	name: string;
	"original-name"?: string;
	originalName?: string;
	"journal?"?: boolean;
	"journal-day"?: number;
	journalDay?: number;
	properties?: Record<string, unknown>;
	updatedAt?: number;
	createdAt?: number;
}

// --- Helpers ---

function getToken(): string | undefined {
	return process.env.LOGSEQ_API_TOKEN;
}

async function callLogseq<T>(method: string, args: unknown[] = []): Promise<T> {
	const token = getToken();
	if (!token) {
		throw new Error("LOGSEQ_API_TOKEN environment variable is not set.");
	}
	const res = await fetch(LOGSEQ_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ method, args }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Logseq API error ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

function journalDayToDate(day: number): string {
	const s = String(day);
	return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Escape a string for embedding as a literal inside a Clojure/Datascript string */
function escapeDsString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatBlock(block: BlockEntity, indent = 0): string {
	const prefix = "  ".repeat(indent);
	const content = block.content?.trim() ?? "";
	if (!content || block["pre-block?"]) return "";
	const lines = [`${prefix}- ${content}`];
	if (block.children?.length) {
		for (const child of block.children) {
			const formatted = formatBlock(child, indent + 1);
			if (formatted) lines.push(formatted);
		}
	}
	return lines.join("\n");
}

function formatPageContent(page: PageEntity, blocks: BlockEntity[]): string {
	const title = page.originalName ?? page["original-name"] ?? page.name;
	const journalDay = page.journalDay ?? page["journal-day"];
	const isJournal = page["journal?"] === true || !!journalDay;
	const dateStr = isJournal && journalDay ? ` (${journalDayToDate(journalDay)})` : "";
	const header = `# ${title}${dateStr}\n`;

	const bodyLines: string[] = [];
	for (const block of blocks) {
		const formatted = formatBlock(block);
		if (formatted) bodyLines.push(formatted);
	}

	return header + (bodyLines.length ? bodyLines.join("\n") : "(empty page)");
}

function formatTaskBlock(task: BlockEntity): string {
	const marker = task.marker ?? "TODO";
	const page = task.page;
	const pageName = page?.originalName ?? page?.name ?? "Unknown page";
	const journalDay = page?.journalDay ?? page?.["journal-day"];
	const dateStr = journalDay ? ` [${journalDayToDate(journalDay)}]` : "";
	// Strip leading marker from content if present
	const content = task.content?.replace(/^(TODO|DOING|DONE|LATER|NOW)\s*/i, "").trim() ?? "";
	return `[${marker}] ${content}\n  → ${pageName}${dateStr}`;
}

const NO_TOKEN_MSG = "LOGSEQ_API_TOKEN is not set. Set it via: export LOGSEQ_API_TOKEN=your-token";

// --- Extension ---

export default function logseqExtension(pi: ExtensionAPI) {
	// Tool: full-text search across all blocks
	pi.registerTool({
		name: "logseq_search",
		label: "Logseq Search",
		description:
			"Case-sensitive full-text search across all Logseq pages and journal entries. Returns matching blocks with their page context. Use when the user asks to find notes, look up information, or search their Logseq knowledge base. Note: search is case-sensitive.",
		promptSnippet: "Search Logseq for notes about a topic",
		parameters: Type.Object({
			query: Type.String({ description: "Text to search for in block content (case-sensitive)" }),
			journals_only: Type.Optional(Type.Boolean({ description: "If true, only search journal pages. Default: false" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of results to return. Default: 20" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { query, journals_only = false, limit = 20 } = params as {
				query: string;
				journals_only?: boolean;
				limit?: number;
			};

			if (!getToken()) return { content: [{ type: "text", text: NO_TOKEN_MSG }], details: { error: "missing_token" } };

			ctx.ui.setStatus("logseq", `Searching for "${query}"...`);

			try {
				const escaped = escapeDsString(query);
				const journalFilter = journals_only ? "\n [?p :block/journal? true]" : "";
				// Note: clojure.string/lower-case does not work in datascriptQuery via HTTP API.
				// Search is case-sensitive. Embed the term directly — :in $ ?q param passing is broken.
				const dsQuery =
					`[:find (pull ?b [:block/uuid :block/content :block/page]) ` +
					`:where [?b :block/content ?c] ` +
					`[(clojure.string/includes? ?c "${escaped}")] ` +
					`[?b :block/page ?p]${journalFilter}]`;

				const rawResults = await callLogseq<unknown[][]>("logseq.DB.datascriptQuery", [dsQuery]);
				ctx.ui.setStatus("logseq", "");

				if (!rawResults?.length) {
					return {
						content: [{ type: "text", text: `No results found for "${query}". Note: search is case-sensitive.` }],
						details: { query, count: 0 },
					};
				}

				const blocks = rawResults.slice(0, limit).map((r) => r[0] as BlockEntity);

				// Collect unique page IDs to fetch page names
				const pageIds = new Set<number>();
				for (const b of blocks) {
					if (b.page?.id) pageIds.add(b.page.id);
				}

				const pageMap = new Map<number, PageEntity>();
				await Promise.all(
					Array.from(pageIds).map(async (id) => {
						try {
							const page = await callLogseq<PageEntity>("logseq.Editor.getPage", [id]);
							if (page) pageMap.set(id, page);
						} catch { /* ignore */ }
					})
				);

				const lines = [`Found ${rawResults.length} result(s) for "${query}"${rawResults.length > limit ? ` (showing first ${limit})` : ""}:\n`];

				for (const block of blocks) {
					const pageId = block.page?.id;
					const page = pageId ? pageMap.get(pageId) : undefined;
					const pageName = page ? (page.originalName ?? page["original-name"] ?? page.name) : "Unknown page";
					const journalDay = page?.journalDay ?? page?.["journal-day"];
					const isJournal = page?.["journal?"] ?? false;
					const dateStr = isJournal && journalDay ? ` [${journalDayToDate(journalDay)}]` : "";

					lines.push(`**${pageName}${dateStr}**`);
					lines.push(`  ${block.content?.trim() ?? ""}`);
					lines.push("");
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { query, total: rawResults.length, returned: blocks.length },
				};
			} catch (err) {
				ctx.ui.setStatus("logseq", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Logseq search failed: ${msg}` }], details: { error: msg } };
			}
		},
	});

	// Tool: search tasks (TODO/DONE)
	pi.registerTool({
		name: "logseq_search_tasks",
		label: "Logseq Search Tasks",
		description:
			"Search for task/todo items in Logseq. Can find TODO (open) and/or DONE (completed) tasks, optionally filtered by a keyword or hashtag. Use when the user asks about tasks, todos, action items, or things to do. The user's Logseq task query syntax is: {{query (AND [task TODO] #SomeTag)}}",
		promptSnippet: "Find TODO tasks in Logseq",
		parameters: Type.Object({
			markers: Type.Optional(
				Type.Array(
					Type.Union([Type.Literal("TODO"), Type.Literal("DOING"), Type.Literal("DONE"), Type.Literal("LATER"), Type.Literal("NOW")]),
					{ description: "Task markers to include. Default: ['TODO']" }
				)
			),
			keyword: Type.Optional(Type.String({ description: "Optional keyword to filter task content (case-insensitive)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of results to return. Default: 30" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { markers = ["TODO"], keyword, limit = 30 } = params as {
				markers?: string[];
				keyword?: string;
				limit?: number;
			};

			if (!getToken()) return { content: [{ type: "text", text: NO_TOKEN_MSG }], details: { error: "missing_token" } };

			ctx.ui.setStatus("logseq", "Fetching tasks...");

			try {
				// logseq.DB.q with (task ...) returns full block+page data directly
				const markerList = markers.map((m) => m.toLowerCase()).join(" ");
				const dslQuery = keyword
					? `(and (task ${markerList}) (full-text-search "${escapeDsString(keyword)}"))`
					: `(task ${markerList})`;

				const tasks = await callLogseq<BlockEntity[]>("logseq.DB.q", [dslQuery]);
				ctx.ui.setStatus("logseq", "");

				if (!tasks?.length) {
					const hint = keyword ? ` matching "${keyword}"` : "";
					return {
						content: [{ type: "text", text: `No ${markers.join("/")} tasks found${hint}.` }],
						details: { markers, keyword, count: 0 },
					};
				}

				// Client-side keyword filter as fallback (full-text-search may not always work)
				let filtered = tasks;
				if (keyword) {
					const lower = keyword.toLowerCase();
					filtered = tasks.filter((t) => t.content?.toLowerCase().includes(lower));
				}

				const displayed = filtered.slice(0, limit);
				const lines = [`${filtered.length} task(s) found${filtered.length > limit ? ` (showing first ${limit})` : ""}:\n`];
				for (const task of displayed) {
					lines.push(formatTaskBlock(task));
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { markers, keyword, total: filtered.length, returned: displayed.length },
				};
			} catch (err) {
				ctx.ui.setStatus("logseq", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Task search failed: ${msg}` }], details: { error: msg } };
			}
		},
	});

	// Tool: list pages
	pi.registerTool({
		name: "logseq_list_pages",
		label: "Logseq List Pages",
		description:
			"List pages in the Logseq graph. Can list all pages, only journal entries, or only regular (non-journal) pages. Use to browse available notes or find pages by name.",
		promptSnippet: "List pages in Logseq",
		parameters: Type.Object({
			type: Type.Optional(
				Type.Union(
					[Type.Literal("all"), Type.Literal("journals"), Type.Literal("pages")],
					{ description: "'all' for everything, 'journals' for daily notes only, 'pages' for non-journal pages only. Default: 'all'" }
				)
			),
			name_filter: Type.Optional(Type.String({ description: "Optional substring to filter page names (case-insensitive)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of pages to return. Default: 50" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { type = "all", name_filter, limit = 50 } = params as {
				type?: "all" | "journals" | "pages";
				name_filter?: string;
				limit?: number;
			};

			if (!getToken()) return { content: [{ type: "text", text: NO_TOKEN_MSG }], details: { error: "missing_token" } };

			ctx.ui.setStatus("logseq", "Fetching pages...");

			try {
				const allPages = await callLogseq<PageEntity[]>("logseq.Editor.getAllPages");
				ctx.ui.setStatus("logseq", "");

				if (!allPages?.length) {
					return { content: [{ type: "text", text: "No pages found in the Logseq graph." }], details: { count: 0 } };
				}

				let filtered = allPages.filter((p) => {
					if (type === "journals") return p["journal?"] === true;
					if (type === "pages") return !p["journal?"];
					return true;
				});

				if (name_filter) {
					const lower = name_filter.toLowerCase();
					filtered = filtered.filter((p) =>
						(p.originalName ?? p["original-name"] ?? p.name).toLowerCase().includes(lower)
					);
				}

				filtered.sort((a, b) => {
					const aDay = a.journalDay ?? a["journal-day"];
					const bDay = b.journalDay ?? b["journal-day"];
					if (a["journal?"] && b["journal?"] && aDay && bDay) return bDay - aDay;
					return (a.originalName ?? a["original-name"] ?? a.name).localeCompare(b.originalName ?? b["original-name"] ?? b.name);
				});

				const total = filtered.length;
				const displayed = filtered.slice(0, limit);

				const lines = [`${total} page(s) found${total > limit ? ` (showing first ${limit})` : ""}:\n`];
				for (const page of displayed) {
					const name = page.originalName ?? page["original-name"] ?? page.name;
					const journalDay = page.journalDay ?? page["journal-day"];
					if (page["journal?"] && journalDay) {
						lines.push(`- ${journalDayToDate(journalDay)} — ${name}`);
					} else {
						lines.push(`- ${name}`);
					}
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { total, returned: displayed.length, type },
				};
			} catch (err) {
				ctx.ui.setStatus("logseq", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Failed to list pages: ${msg}` }], details: { error: msg } };
			}
		},
	});

	// Tool: get page content
	pi.registerTool({
		name: "logseq_get_page",
		label: "Logseq Get Page",
		description:
			"Get the full content of a specific Logseq page or journal entry, including all its blocks. Use when the user wants to read a specific page, note, or daily journal. For journal entries, use the date format YYYY-MM-DD or the page name (e.g. 'Mar 31st, 2026').",
		promptSnippet: "Get the content of a Logseq page",
		parameters: Type.Object({
			page_name: Type.String({
				description: "Name of the page to retrieve. For journals, use YYYY-MM-DD format or the exact journal page name.",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { page_name } = params as { page_name: string };

			if (!getToken()) return { content: [{ type: "text", text: NO_TOKEN_MSG }], details: { error: "missing_token" } };

			ctx.ui.setStatus("logseq", `Loading page "${page_name}"...`);

			try {
				// Resolve YYYY-MM-DD to Logseq journal page name
				let resolvedName = page_name;
				const dateMatch = page_name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
				if (dateMatch) {
					const d = new Date(`${page_name}T00:00:00`);
					const day = d.getDate();
					const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3 || Math.floor(day / 10) === 1) ? 0 : day % 10] ?? "th";
					const month = d.toLocaleString("en-US", { month: "short" });
					resolvedName = `${month} ${day}${suffix}, ${d.getFullYear()}`;
				}

				const page = await callLogseq<PageEntity | null>("logseq.Editor.getPage", [resolvedName]);
				if (!page) {
					return {
						content: [{ type: "text", text: `Page "${page_name}" not found in Logseq.` }],
						details: { error: "page_not_found", page_name },
					};
				}

				const blocks = await callLogseq<BlockEntity[]>("logseq.Editor.getPageBlocksTree", [page.name]);
				ctx.ui.setStatus("logseq", "");

				const text = formatPageContent(page, blocks ?? []);
				return {
					content: [{ type: "text", text }],
					details: { page_name: page.originalName ?? page["original-name"] ?? page.name, block_count: blocks?.length ?? 0 },
				};
			} catch (err) {
				ctx.ui.setStatus("logseq", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Failed to get page "${page_name}": ${msg}` }], details: { error: msg } };
			}
		},
	});
}
