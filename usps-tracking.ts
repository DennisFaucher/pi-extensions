/**
 * USPS Package Tracking Extension
 *
 * Tracks USPS packages using the official USPS Web Tools API v3 (OAuth 2.0).
 *
 * Setup:
 *   1. Register at https://developer.usps.com/ to get a Client ID and Secret
 *   2. export USPS_CLIENT_ID=your_client_id
 *   3. export USPS_CLIENT_SECRET=your_client_secret
 *
 * Tools registered:
 *   - usps_track_package: Get tracking status and event history for a USPS tracking number
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const USPS_AUTH_URL = "https://api.usps.com/oauth2/v3/token";
const USPS_TRACKING_URL = "https://api.usps.com/tracking/v3/tracking";

// --- Types ---

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
}

interface TrackingEvent {
	eventType: string;
	eventTimestamp: string;
	eventCountry?: string;
	eventCity?: string;
	eventState?: string;
	eventZIPCode?: string;
	name?: string;
	authorizedAgent?: boolean;
	eventDescription?: string;
}

interface TrackingResponse {
	trackingNumber: string;
	mailClass?: string;
	mailType?: string;
	additionalInfo?: string;
	trackingEvents?: TrackingEvent[];
	proofOfDelivery?: {
		deliveryDate?: string;
		deliveryTime?: string;
		deliveryEventCode?: string;
		name?: string;
		geospatialResult?: { geometry?: { coordinates?: number[] } };
	};
}

// --- Helpers ---

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
	// const clientId = process.env.USPS_CLIENT_ID;
	// const clientSecret = process.env.USPS_CLIENT_SECRET;
	const clientId = "McFW7muEfZn8yQaz2BDHEhqgFw331sTNGNiWPoIpo9LWBfjO";
	const clientSecret = "qhhNx1EOrZM5NmYPh1KsIEl51yIh9TOYdHeRmekL7AGJZQ9iHSALbuUKKju03SoP";

	if (!clientId || !clientSecret) {
		throw new Error("USPS_CLIENT_ID and USPS_CLIENT_SECRET environment variables are required.");
	}

	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now + 30_000) {
		return cachedToken.token;
	}

	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: clientId,
		client_secret: clientSecret,
	});

	const res = await fetch(USPS_AUTH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`USPS auth failed (${res.status}): ${text}`);
	}

	const data = (await res.json()) as TokenResponse;
	cachedToken = {
		token: data.access_token,
		expiresAt: now + data.expires_in * 1000,
	};
	return data.access_token;
}

async function fetchTracking(trackingNumber: string, token: string, expand: string): Promise<TrackingResponse> {
	const url = `${USPS_TRACKING_URL}/${encodeURIComponent(trackingNumber)}?expand=${expand}`;
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		if (res.status === 404) {
			throw new Error(`Tracking number "${trackingNumber}" not found. Verify the number is correct and try again.`);
		}
		throw new Error(`USPS API error (${res.status}): ${text}`);
	}

	return res.json() as Promise<TrackingResponse>;
}

function formatTimestamp(ts: string): string {
	const date = new Date(ts);
	if (isNaN(date.getTime())) return ts;
	return date.toLocaleString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatLocation(event: TrackingEvent): string {
	const parts = [event.eventCity, event.eventState, event.eventZIPCode, event.eventCountry].filter(Boolean);
	return parts.join(", ");
}

function formatTrackingResult(data: TrackingResponse, maxEvents: number): string {
	const lines: string[] = [];

	lines.push(`USPS Tracking: ${data.trackingNumber}`);

	if (data.mailClass || data.mailType) {
		const classInfo = [data.mailClass, data.mailType].filter(Boolean).join(" — ");
		lines.push(`Service: ${classInfo}`);
	}

	const events = data.trackingEvents ?? [];

	// Latest status
	if (events.length > 0) {
		const latest = events[0];
		lines.push(`\nStatus: ${latest.eventDescription ?? latest.eventType}`);
		const loc = formatLocation(latest);
		if (loc) lines.push(`Location: ${loc}`);
		lines.push(`Updated: ${formatTimestamp(latest.eventTimestamp)}`);
	} else {
		lines.push("\nStatus: No tracking events available yet.");
	}

	// Proof of delivery
	if (data.proofOfDelivery?.deliveryDate) {
		const pod = data.proofOfDelivery;
		lines.push(`\nDelivered: ${pod.deliveryDate}${pod.deliveryTime ? " at " + pod.deliveryTime : ""}`);
		if (pod.name) lines.push(`Signed by: ${pod.name}`);
	}

	// Event history
	if (events.length > 1) {
		const limit = Math.min(events.length, maxEvents);
		lines.push(`\nTracking History (${limit} of ${events.length} events):`);
		for (let i = 0; i < limit; i++) {
			const ev = events[i];
			const desc = ev.eventDescription ?? ev.eventType;
			const loc = formatLocation(ev);
			const time = formatTimestamp(ev.eventTimestamp);
			lines.push(`  ${time}`);
			lines.push(`    ${desc}${loc ? " — " + loc : ""}`);
		}
		if (events.length > maxEvents) {
			lines.push(`  ... and ${events.length - maxEvents} more events`);
		}
	}

	if (data.additionalInfo) {
		lines.push(`\nNote: ${data.additionalInfo}`);
	}

	return lines.join("\n");
}

// --- Extension ---

export default function uspsTrackingExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "usps_track_package",
		label: "USPS Package Tracker",
		description:
			"Track a USPS package using its tracking number. Returns current status, location, and delivery history. Use whenever the user asks about a USPS shipment, tracking number, or package status. Supported formats: 20-22 digit domestic numbers (e.g. 9400111899223397441225), and alphanumeric international formats with a two-letter prefix and 'US' suffix (e.g. RF824021038US, EA123456789US, CP123456789US). Do NOT reject alphanumeric tracking numbers ending in US — these are valid USPS international formats.",
		promptSnippet: "Track a USPS package by tracking number (domestic or international)",
		parameters: Type.Object({
			tracking_number: Type.String({
				description: "USPS tracking number. Domestic: 20-22 digits (e.g. 9400111899223397441225). International: two-letter prefix + digits + US suffix (e.g. RF824021038US, EA123456789US).",
			}),
			max_events: Type.Optional(
				Type.Number({
					description: "Maximum number of tracking events to show in history. Default: 10",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// const clientId = process.env.USPS_CLIENT_ID;
			// const clientSecret = process.env.USPS_CLIENT_SECRET;
	                const clientId = "McFW7muEfZn8yQaz2BDHEhqgFw331sTNGNiWPoIpo9LWBfjO";
	                const clientSecret = "qhhNx1EOrZM5NmYPh1KsIEl51yIh9TOYdHeRmekL7AGJZQ9iHSALbuUKKju03SoP";

			if (!clientId || !clientSecret) {
				return {
					content: [
						{
							type: "text",
							text: "USPS_CLIENT_ID and USPS_CLIENT_SECRET are not set.\n\n1. Register at https://developer.usps.com/ to get credentials.\n2. Set the environment variables and restart pi.",
						},
					],
					details: { error: "missing_credentials" },
				};
			}

			const { tracking_number, max_events = 10 } = params as {
				tracking_number: string;
				max_events?: number;
			};

			const normalized = tracking_number.replace(/\s+/g, "").toUpperCase();

			ctx.ui.setStatus("usps-tracking", `Fetching tracking info for ${normalized}...`);

			let text: string;
			try {
				const token = await getAccessToken();
				const data = await fetchTracking(normalized, token, "DETAIL");
				text = formatTrackingResult(data, max_events);
			} catch (err: unknown) {
				ctx.ui.setStatus("usps-tracking", "");
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message, tracking_number: normalized },
					isError: true,
				};
			}

			ctx.ui.setStatus("usps-tracking", "");
			return {
				content: [{ type: "text", text }],
				details: { tracking_number: normalized },
			};
		},
	});
}
