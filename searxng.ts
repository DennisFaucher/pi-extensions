/**
 * SearXNG Web Search Extension
 *
 * Provides web search using a self-hosted SearXNG instance.
 *
 * Tools registered:
 *   - web_search: Search the web using SearXNG
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ** EDIT THE NEXT LINE FOR YOUR SEARXNG SERVER **
const SEARXNG_BASE_URL = "https://your.server.here/search";

// --- Types ---

interface SearXNGResult {
	url: string;
	title: string;
	content?: string;
	engine?: string;
	score?: number;
	category?: string;
	publishedDate?: string;
}

interface SearXNGResponse {
	query: string;
	results: SearXNGResult[];
	suggestions?: string[];
	answers?: string[];
	infoboxes?: { infobox: string; content: string }[];
}

// --- Extension ---

export default function searxngExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using SearXNG. Use this to find current information, news, documentation, or answers to questions that require up-to-date or external knowledge.",
		promptSnippet: "Search the web for information",
		parameters: Type.Object({
			query: Type.String({ description: "The search query" }),
			max_results: Type.Optional(Type.Number({ description: "Maximum number of results to return. Default: 10" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { query, max_results = 10 } = params as {
				query: string;
				max_results?: number;
			};

			ctx.ui.setStatus("searxng", `Searching for "${query}"...`);

			let response: SearXNGResponse;
			try {
				const url = `${SEARXNG_BASE_URL}?q=${encodeURIComponent(query)}&format=json`;
				const res = await fetch(url, {
					headers: {
						Accept: "application/json",
					},
				});
				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`HTTP ${res.status}: ${body}`);
				}
				response = (await res.json()) as SearXNGResponse;
			} catch (err) {
				ctx.ui.setStatus("searxng", "");
				return {
					content: [{ type: "text", text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
					details: { error: String(err) },
				};
			}

			ctx.ui.setStatus("searxng", "");

			const results = response.results.slice(0, max_results);

			if (!results.length) {
				return {
					content: [{ type: "text", text: `No results found for "${query}".` }],
					details: { query, result_count: 0 },
				};
			}

			const lines: string[] = [`Search results for "${query}":\n`];

			// Include any direct answers first
			if (response.answers?.length) {
				for (const answer of response.answers) {
					lines.push(`Answer: ${answer}\n`);
				}
			}

			// Include infoboxes
			if (response.infoboxes?.length) {
				for (const box of response.infoboxes) {
					lines.push(`${box.infobox}: ${box.content}\n`);
				}
			}

			// List results
			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				lines.push(`${i + 1}. ${r.title}`);
				lines.push(`   URL: ${r.url}`);
				if (r.content) lines.push(`   ${r.content}`);
				if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
				lines.push("");
			}

			// Suggestions
			if (response.suggestions?.length) {
				lines.push(`Related searches: ${response.suggestions.slice(0, 5).join(", ")}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { query, result_count: results.length },
			};
		},
	});
}
