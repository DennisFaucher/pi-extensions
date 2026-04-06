/**
 * Bejamas ASCII Art Extension
 *
 * Generates ASCII art from a text prompt using the bejamas.com AI ASCII art generator.
 * No API key required.
 *
 * Available styles: classic, dots, blocks, geometric, simple, box, horizontal, vertical,
 *                   braille, boxDrawing, alphabet
 *
 * Tools registered:
 *   - bejamas_ascii_art: Generate ASCII art from a prompt
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const API_URL = "https://bejamas.com/api/create-ascii.data";

const VALID_STYLES = ["classic", "dots", "blocks", "geometric", "simple", "box", "horizontal", "vertical", "braille", "boxDrawing", "alphabet"] as const;
type Style = (typeof VALID_STYLES)[number];

/**
 * Parse the turbo-stream response format used by bejamas.com.
 * The format is a JSON array where:
 *   arr[0] = root reference map
 *   arr[1] = "data" key name
 *   arr[2] = data object mapping key-indices to value-indices
 *   arr[N] = key name strings or ASCII art strings
 */
function parseTurboStream(raw: string): Record<string, string> {
	const arr = JSON.parse(raw) as (string | number | Record<string, number>)[];
	const dataObj = arr[2] as Record<string, number>;
	const result: Record<string, string> = {};

	for (const [k, v] of Object.entries(dataObj)) {
		const keyIdx = parseInt(k.slice(1), 10);
		const keyName = arr[keyIdx] as string;
		if (v >= 0 && typeof arr[v] === "string") {
			result[keyName] = arr[v] as string;
		}
	}

	return result;
}

export default function bejamasAsciiExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "bejamas_ascii_art",
		label: "ASCII Art (Bejamas)",
		description:
			"Generate ASCII art from a text prompt using the bejamas.com AI ASCII art generator. " +
			"Use when the user asks for ASCII art, text art, or wants to visualize something as characters. " +
			`Available styles: ${VALID_STYLES.join(", ")}.`,
		promptSnippet: "Generate ASCII art of...",
		parameters: Type.Object({
			prompt: Type.String({
				description: "Text prompt describing what to generate, e.g. 'a cat', 'a spaceship', 'a mountain landscape'",
			}),
			style: Type.Optional(
				Type.String({
					description: `ASCII art style. One of: ${VALID_STYLES.join(", ")}. Defaults to 'alphabet'.`,
				})
			),
		}),

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const { prompt } = params as { prompt: string; style?: string };
			const rawStyle = (params as { style?: string }).style ?? "alphabet";
			const style: Style = VALID_STYLES.includes(rawStyle as Style) ? (rawStyle as Style) : "alphabet";

			ctx.ui.setStatus(toolCallId, `Generating ${style} ASCII art…`);

			try {
				const body = new URLSearchParams({
					_route: "routes/api.create-ascii",
					prompt,
					style,
				});

				const resp = await fetch(API_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: body.toString(),
					signal,
				});

				if (!resp.ok) {
					const errText = await resp.text().catch(() => "");
					throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 200)}`);
				}

				const raw = await resp.text();
				const results = parseTurboStream(raw);

				const art = results[style] ?? results["classic"];
				if (!art) {
					throw new Error("No ASCII art found in response");
				}

				const availableStyles = Object.keys(results).filter((k) => k !== "id");
				const header = `ASCII art — style: ${style} | prompt: "${prompt}"`;
				const output = `${header}\n\n\`\`\`\n${art}\n\`\`\``;

				ctx.ui.setStatus(toolCallId, "");
				return {
					content: [{ type: "text", text: output }],
					details: { style, prompt, availableStyles, allResults: results },
				};
			} catch (err) {
				ctx.ui.setStatus(toolCallId, "");
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error generating ASCII art: ${message}` }],
					isError: true,
				};
			}
		},
	});
}
