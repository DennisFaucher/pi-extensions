/**
 * Pushover Notification Extension
 *
 * Sends push notifications via the Pushover API (pushover.net).
 *
 * Setup:
 *   1. Create an account at https://pushover.net/ and install the app on your device
 *   2. Create an application at https://pushover.net/apps/build to get an API token
 *   3. export PUSHOVER_API_TOKEN=your_application_token
 *   4. export PUSHOVER_USER_KEY=your_user_key  (found on your Pushover dashboard)
 *
 * Tools registered:
 *   - pushover_send: Send a push notification via Pushover
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const PUSHOVER_URL = "https://api.pushover.net/1/messages.json";

// --- Types ---

interface PushoverResponse {
	status: number;
	request: string;
	errors?: string[];
}

// --- Helpers ---

function getCredentials(): { token: string; userKey: string } | null {
	// const token = process.env.PUSHOVER_API_TOKEN;
	// const userKey = process.env.PUSHOVER_USER_KEY;
	const token = "YourTokenGoesHere";
	const userKey = "YourKeyGoesHere";
	if (!token || !userKey) return null;
	return { token, userKey };
}

// --- Extension ---

export default function pushoverExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "pushover_send",
		label: "Pushover Notification",
		description:
			"Send a push notification to the user's devices via Pushover. Use when the user asks to send a notification, alert, reminder, or push message. Supports titles, priority levels (silent, low, normal, high, emergency), custom sounds, and URLs.",
		promptSnippet: "Send a push notification via Pushover",
		parameters: Type.Object({
			message: Type.String({
				description: "The notification message body (required)",
			}),
			title: Type.Optional(
				Type.String({
					description: "Notification title. Defaults to the app name if omitted.",
				})
			),
			priority: Type.Optional(
				Type.Union(
					[
						Type.Literal("silent"),
						Type.Literal("low"),
						Type.Literal("normal"),
						Type.Literal("high"),
						Type.Literal("emergency"),
					],
					{
						description:
							"Priority: 'silent' (no notification), 'low' (no sound), 'normal' (default), 'high' (bypass quiet hours), 'emergency' (repeat until acknowledged)",
					}
				)
			),
			sound: Type.Optional(
				Type.String({
					description:
						"Notification sound name (e.g. 'pushover', 'bike', 'bugle', 'cashregister', 'classical', 'cosmic', 'falling', 'gamelan', 'incoming', 'intermission', 'magic', 'mechanical', 'pianobar', 'siren', 'spacealarm', 'tugboat', 'alien', 'climb', 'persistent', 'echo', 'updown', 'vibrate', 'none')",
				})
			),
			url: Type.Optional(
				Type.String({
					description: "A supplementary URL to attach to the notification",
				})
			),
			url_title: Type.Optional(
				Type.String({
					description: "Title for the URL (only used when url is provided)",
				})
			),
			device: Type.Optional(
				Type.String({
					description: "Target a specific device name. Omit to send to all devices.",
				})
			),
			retry: Type.Optional(
				Type.Number({
					description:
						"For emergency priority: how often (in seconds, min 30) to retry until acknowledged. Default: 60",
				})
			),
			expire: Type.Optional(
				Type.Number({
					description:
						"For emergency priority: how many seconds before giving up. Max 10800 (3 hours). Default: 3600",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const creds = getCredentials();
			if (!creds) {
				return {
					content: [
						{
							type: "text",
							text: "PUSHOVER_API_TOKEN or PUSHOVER_USER_KEY is not set.\n\n1. Create an account and app at https://pushover.net/\n2. Set the environment variables and restart pi.",
						},
					],
					details: { error: "missing_credentials" },
				};
			}

			const {
				message,
				title,
				priority = "normal",
				sound,
				url,
				url_title,
				device,
				retry = 60,
				expire = 3600,
			} = params as {
				message: string;
				title?: string;
				priority?: "silent" | "low" | "normal" | "high" | "emergency";
				sound?: string;
				url?: string;
				url_title?: string;
				device?: string;
				retry?: number;
				expire?: number;
			};

			const priorityMap: Record<string, number> = {
				silent: -2,
				low: -1,
				normal: 0,
				high: 1,
				emergency: 2,
			};

			const body = new URLSearchParams({
				token: creds.token,
				user: creds.userKey,
				message,
				priority: String(priorityMap[priority]),
			});

			if (title) body.set("title", title);
			if (sound) body.set("sound", sound);
			if (url) body.set("url", url);
			if (url_title && url) body.set("url_title", url_title);
			if (device) body.set("device", device);
			if (priority === "emergency") {
				body.set("retry", String(Math.max(30, retry)));
				body.set("expire", String(Math.min(10800, expire)));
			}

			ctx.ui.setStatus("pushover", "Sending notification...");

			let result: string;
			let isError = false;

			try {
				const res = await fetch(PUSHOVER_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body,
				});

				const data = (await res.json()) as PushoverResponse;

				if (data.status === 1) {
					const dest = device ? `to device "${device}"` : "to all devices";
					const prio = priority !== "normal" ? ` [${priority}]` : "";
					result = `Notification sent${prio} ${dest}. Request ID: ${data.request}`;
				} else {
					isError = true;
					result = `Pushover error: ${(data.errors ?? ["Unknown error"]).join(", ")}`;
				}
			} catch (err: unknown) {
				isError = true;
				result = `Failed to send notification: ${err instanceof Error ? err.message : String(err)}`;
			}

			ctx.ui.setStatus("pushover", "");
			return {
				content: [{ type: "text", text: result }],
				details: { priority, device, isError },
				isError,
			};
		},
	});
}
