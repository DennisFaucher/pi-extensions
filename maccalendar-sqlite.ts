/**
 * Mac Calendar SQLite Extension for Pi
 *
 * Reads events directly from macOS Calendar's SQLite database.
 * Instant queries — no AppleScript, no Calendar app IPC required.
 *
 * Requirements:
 *   - Full Disk Access granted to the app running pi
 *     (System Settings → Privacy & Security → Full Disk Access)
 *
 * Tools registered:
 *   - calendar_db_list_calendars  List all calendars with event counts
 *   - calendar_db_list_events     List events in a date range (handles recurring events)
 *   - calendar_db_get_event       Get full details of an event by ID
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

const execFileAsync = promisify(execFile);
const HOME = process.env.HOME!;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const DB = join(
	HOME,
	"Library",
	"Group Containers",
	"group.com.apple.calendar",
	"Calendar.sqlitedb",
);

/** Dates in Calendar.sqlitedb are seconds since 2001-01-01 (Core Data epoch).
 *  Unix epoch offset = 978307200 seconds. */
const CD = 978307200;

const toUnix  = (cd: number) => cd + CD;
const toCoreData = (unix: number) => unix - CD;
const nowCD   = () => toCoreData(Math.floor(Date.now() / 1000));

async function queryDb<T = Record<string, unknown>>(sql: string): Promise<T[]> {
	const { stdout } = await execFileAsync("sqlite3", ["-json", DB, sql], {
		maxBuffer: 20 * 1024 * 1024,
	});
	const t = stdout.trim();
	return t ? (JSON.parse(t) as T[]) : [];
}

const esc = (s: string) => s.replace(/'/g, "''");

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatDate(cd: number, allDay: boolean): string {
	const d = new Date(toUnix(cd) * 1000);
	return allDay
		? d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })
		: d.toLocaleString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Recurrence expansion
// ---------------------------------------------------------------------------

/** Frequency values used by macOS Calendar */
const FREQ = { DAILY: 1, WEEKLY: 2, MONTHLY: 3, YEARLY: 4 } as const;

/** Day-of-week codes in the D= specifier → JS getDay() values (0=Sun) */
const DOW_MAP: Record<string, number> = {
	SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface RecurRow {
	event_id: number;
	summary: string;
	start_date: number;
	end_date: number;
	all_day: number;
	calendar_name: string;
	loc_title: string | null;
	loc_address: string | null;
	description: string | null;
	conference_url: string | null;
	frequency: number;
	recur_interval: number;
	specifier: string | null;
	recur_end: number | null;         // explicit end date (RRULE UNTIL)
	cached_end_date: number | null;   // pre-computed end for count-based rules
	recur_count: number;
}

interface ExpandedEvent {
	ROWID: number;
	summary: string;
	ev_start: number;
	ev_end: number;
	all_day: number;
	calendar_name: string;
	loc_title: string | null;
	loc_address: string | null;
	description: string | null;
	conference_url: string | null;
	attendee_count: number;
}

/**
 * Parse the D= clause of an Apple Calendar specifier into JS day-of-week numbers.
 * e.g. "D=0MO,0WE,0FR" → [1, 3, 5]
 */
function parseDow(specifier: string | null): number[] {
	if (!specifier) return [];
	const m = specifier.match(/D=([^;]+)/);
	if (!m) return [];
	return m[1]
		.split(",")
		.map((token) => {
			const code = token.match(/([A-Z]{2})$/);
			return code ? (DOW_MAP[code[1]] ?? -1) : -1;
		})
		.filter((d) => d >= 0);
}

/**
 * Advance a Core Data timestamp by N calendar months, preserving time-of-day.
 */
function addMonths(cdTs: number, months: number): number {
	const d = new Date(toUnix(cdTs) * 1000);
	d.setMonth(d.getMonth() + months);
	return toCoreData(Math.floor(d.getTime() / 1000));
}

/**
 * Advance a Core Data timestamp by N calendar years, preserving month/day/time.
 */
function addYears(cdTs: number, years: number): number {
	const d = new Date(toUnix(cdTs) * 1000);
	d.setFullYear(d.getFullYear() + years);
	return toCoreData(Math.floor(d.getTime() / 1000));
}

/**
 * Expand a single recurring event master into concrete occurrences within [rangeStart, rangeEnd].
 * Handles daily, weekly (with optional day-of-week specifier), monthly, and yearly frequencies.
 */
function expandRecurrence(ev: RecurRow, rangeStart: number, rangeEnd: number): ExpandedEvent[] {
	const results: ExpandedEvent[] = [];
	const duration = ev.end_date - ev.start_date;
	const interval = ev.recur_interval || 1;
	// Use cached_end_date (pre-computed for count-based rules) when end_date is absent
	const recurEnd = ev.recur_end ?? ev.cached_end_date;

	const inRange = (ts: number) =>
		ts >= rangeStart && ts <= rangeEnd && (!recurEnd || ts <= recurEnd);

	const base: Omit<ExpandedEvent, "ev_start" | "ev_end"> = {
		ROWID: ev.event_id,
		summary: ev.summary,
		all_day: ev.all_day,
		calendar_name: ev.calendar_name,
		loc_title: ev.loc_title,
		loc_address: ev.loc_address,
		description: ev.description,
		conference_url: ev.conference_url,
		attendee_count: 0,
	};

	const push = (ts: number) => results.push({ ...base, ev_start: ts, ev_end: ts + duration });

	if (ev.frequency === FREQ.DAILY) {
		const stepSec = interval * 86400;
		// Find first occurrence >= rangeStart by advancing from start_date
		let cur = ev.start_date;
		if (stepSec > 0) {
			const steps = Math.max(0, Math.ceil((rangeStart - cur) / stepSec));
			cur += steps * stepSec;
		}
		while (cur <= rangeEnd) {
			if (inRange(cur)) push(cur);
			cur += stepSec;
		}

	} else if (ev.frequency === FREQ.WEEKLY) {
		const stepSec = interval * 7 * 86400;
		const dows = parseDow(ev.specifier);

		if (dows.length === 0) {
			// Simple weekly: same weekday as start_date
			let cur = ev.start_date;
			if (stepSec > 0) {
				const steps = Math.max(0, Math.ceil((rangeStart - cur) / stepSec));
				cur += steps * stepSec;
				if (cur > rangeEnd) return results;
				// Step back one to ensure we don't overshoot due to integer rounding
				if (cur > rangeStart && cur - stepSec >= rangeStart) cur -= stepSec;
			}
			while (cur <= rangeEnd) {
				if (cur >= rangeStart && inRange(cur)) push(cur);
				cur += stepSec;
			}
		} else {
			// Multi-day weekly: expand each day-of-week within the range
			// Align to the week boundaries of the recurrence
			const weekSec = interval * 7 * 86400;
			// Find the Monday of the week containing start_date (as anchor)
			const startD = new Date(toUnix(ev.start_date) * 1000);
			const startDow = startD.getDay(); // 0=Sun
			// Anchor: Sunday of the start week (in Core Data seconds)
			const sunOfStartWeek = ev.start_date - startDow * 86400 - (ev.start_date % 86400 === 0 ? 0 : 0);

			const rangeStartD = new Date(toUnix(rangeStart) * 1000);
			const rangeStartDow = rangeStartD.getDay();
			const sunOfRangeStartWeek = rangeStart - rangeStartDow * 86400;

			// Find the nearest recurrence-aligned week start at or before rangeStart
			const weeksDiff = Math.floor((sunOfRangeStartWeek - sunOfStartWeek) / weekSec);
			let weekStart = sunOfStartWeek + Math.max(0, weeksDiff - 1) * weekSec;

			while (weekStart <= rangeEnd + 7 * 86400) {
				for (const dow of dows) {
					const ts = weekStart + dow * 86400;
					// Preserve the time-of-day from start_date
					const timeOffset = ev.start_date - (ev.start_date - startDow * 86400);
					const tsWithTime = ts + (ev.start_date % 86400);
					if (tsWithTime >= ev.start_date && inRange(tsWithTime)) push(tsWithTime);
				}
				weekStart += weekSec;
			}
		}

	} else if (ev.frequency === FREQ.MONTHLY) {
		// Same day-of-month, every N months
		const startD = new Date(toUnix(ev.start_date) * 1000);
		const targetDay = startD.getDate();

		// Step forward month by month until we pass rangeEnd
		// Start from a few months before rangeStart to avoid missing edge cases
		let cur = addMonths(ev.start_date, 0);
		const rangeStartD = new Date(toUnix(rangeStart) * 1000);
		const monthsDiff = (rangeStartD.getFullYear() - startD.getFullYear()) * 12
			+ (rangeStartD.getMonth() - startD.getMonth());
		cur = addMonths(ev.start_date, Math.max(0, monthsDiff - interval));

		let safety = 0;
		while (cur <= rangeEnd && safety++ < 500) {
			const d = new Date(toUnix(cur) * 1000);
			if (d.getDate() === targetDay && inRange(cur)) push(cur);
			cur = addMonths(cur, interval);
		}

	} else if (ev.frequency === FREQ.YEARLY) {
		// Same month+day each year (ignore complex specifiers)
		const startD = new Date(toUnix(ev.start_date) * 1000);
		const rangeStartYear = new Date(toUnix(rangeStart) * 1000).getFullYear();
		const rangeEndYear   = new Date(toUnix(rangeEnd)   * 1000).getFullYear();

		for (let yr = rangeStartYear - 1; yr <= rangeEndYear + 1; yr++) {
			const ts = addYears(ev.start_date, yr - startD.getFullYear());
			if (ts >= ev.start_date && inRange(ts)) push(ts);
		}
	}

	return results;
}

/**
 * Fetch all active recurring event masters and expand their occurrences within the range.
 * "Active" = has not ended before rangeStart.
 */
async function getExpandedRecurrences(
	rangeStart: number,
	rangeEnd: number,
	calFilter?: string,
	searchFilter?: string,
): Promise<ExpandedEvent[]> {
	const calClause = calFilter ? `AND c.title LIKE '%${esc(calFilter)}%'` : "";
	const searchClause = searchFilter ? `AND ci.summary LIKE '%${esc(searchFilter)}%'` : "";

	const rows = await queryDb<RecurRow>(`
		SELECT ci.ROWID AS event_id,
		       ci.summary,
		       ci.start_date,
		       ci.end_date,
		       ci.all_day,
		       c.title           AS calendar_name,
		       l.title           AS loc_title,
		       l.address         AS loc_address,
		       ci.description,
		       ci.conference_url,
		       r.frequency,
		       r.interval        AS recur_interval,
		       r.specifier,
		       r.end_date        AS recur_end,
		       r.cached_end_date AS cached_end_date,
		       r.count           AS recur_count
		FROM CalendarItem ci
		JOIN Recurrence r    ON r.owner_id      = ci.ROWID
		JOIN Calendar c      ON ci.calendar_id  = c.ROWID
		LEFT JOIN Location l ON l.item_owner_id = ci.ROWID
		WHERE ci.start_date <= ${rangeEnd}
		  AND ci.hidden = 0
		  AND (
		    -- effective end = explicit end_date, or cached_end_date for count-based rules
		    COALESCE(r.end_date, r.cached_end_date) IS NULL
		    OR COALESCE(r.end_date, r.cached_end_date) >= ${rangeStart}
		  )
		  ${calClause}
		  ${searchClause}
	`);

	const all: ExpandedEvent[] = [];
	for (const row of rows) {
		const occurrences = expandRecurrence(row, rangeStart, rangeEnd);
		all.push(...occurrences);
	}
	return all;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarRow {
	ROWID: number;
	title: string;
	store_name: string;
	event_count: number;
}

interface AttendeeRow {
	email: string;
	comment: string | null;
	status: number;
	is_self: number;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function macCalendarSqliteExtension(pi: ExtensionAPI) {

	// ── List Calendars ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "calendar_db_list_calendars",
		label: "Calendar DB: List Calendars",
		description:
			"List all calendars in macOS Calendar app with their names and event counts. " +
			"Requires Full Disk Access.",
		promptSnippet: "List all calendars in Mac Calendar",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("maccalendar", "Querying calendars…");
				const rows = await queryDb<CalendarRow>(`
					SELECT c.ROWID, c.title,
					       COALESCE(s.name, '') AS store_name,
					       COUNT(ci.ROWID)       AS event_count
					FROM Calendar c
					LEFT JOIN Store s         ON c.store_id = s.ROWID
					LEFT JOIN CalendarItem ci ON ci.calendar_id = c.ROWID
					GROUP BY c.ROWID
					ORDER BY c.title
				`);
				ctx.ui.setStatus("maccalendar", "");
				if (!rows.length) return { content: [{ type: "text", text: "No calendars found." }] };
				const lines = rows.map(
					(r) => `[id:${r.ROWID}] ${r.title}  (${r.event_count} events)${r.store_name ? `  — ${r.store_name}` : ""}`,
				);
				return {
					content: [{ type: "text", text: `${rows.length} calendars:\n\n` + lines.join("\n") }],
					details: { calendars: rows },
				};
			} catch (err) {
				ctx.ui.setStatus("maccalendar", "");
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	});

	// ── List Events ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "calendar_db_list_events",
		label: "Calendar DB: List Events",
		description:
			"List calendar events in a date range using macOS Calendar's SQLite database. " +
			"Correctly handles recurring events (weekly, monthly, yearly, etc.) by expanding " +
			"recurrence rules directly — not dependent on the lazy OccurrenceCache. " +
			"Requires Full Disk Access.",
		promptSnippet: "List upcoming calendar events",
		parameters: Type.Object({
			days_ahead: Type.Optional(Type.Integer({ description: "Days ahead from today (default: 7)" })),
			days_back:  Type.Optional(Type.Integer({ description: "Days in the past to include (default: 0)" })),
			start_date: Type.Optional(Type.String({ description: "Explicit start date YYYY-MM-DD (overrides days_back)" })),
			end_date:   Type.Optional(Type.String({ description: "Explicit end date YYYY-MM-DD (overrides days_ahead)" })),
			calendar_name: Type.Optional(Type.String({ description: "Filter by calendar name (partial match)" })),
			search:     Type.Optional(Type.String({ description: "Filter event titles (case-insensitive)" })),
			limit:      Type.Optional(Type.Integer({ description: "Max events to return (default: 50)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("maccalendar", "Querying events…");
				const p          = params as any;
				const calFilter  = p.calendar_name as string | undefined;
				const search     = p.search        as string | undefined;
				const limit      = (p.limit as number | undefined) ?? 50;

				// Resolve date range
				let rangeStart: number;
				let rangeEnd: number;
				const now = nowCD();

				if (p.start_date) {
					rangeStart = toCoreData(Math.floor(new Date(p.start_date + "T00:00:00").getTime() / 1000));
				} else {
					rangeStart = now - ((p.days_back as number | undefined) ?? 0) * 86400;
				}
				if (p.end_date) {
					rangeEnd = toCoreData(Math.floor(new Date(p.end_date + "T23:59:59").getTime() / 1000));
				} else {
					rangeEnd = now + ((p.days_ahead as number | undefined) ?? 7) * 86400;
				}

				const calClause    = calFilter ? `AND c.title LIKE '%${esc(calFilter)}%'` : "";
				const searchClause = search    ? `AND ci.summary LIKE '%${esc(search)}%'`  : "";

				// ── Source 1: non-recurring events with start_date in range
				const nonRecurring = await queryDb<ExpandedEvent>(`
					SELECT ci.ROWID,
					       ci.summary,
					       ci.start_date   AS ev_start,
					       ci.end_date     AS ev_end,
					       ci.all_day,
					       c.title         AS calendar_name,
					       l.title         AS loc_title,
					       l.address       AS loc_address,
					       ci.description,
					       ci.conference_url,
					       (SELECT COUNT(*) FROM Participant pr WHERE pr.owner_id = ci.ROWID) AS attendee_count
					FROM CalendarItem ci
					JOIN Calendar c      ON ci.calendar_id   = c.ROWID
					LEFT JOIN Location l ON l.item_owner_id  = ci.ROWID
					WHERE ci.start_date >= ${rangeStart}
					  AND ci.start_date <= ${rangeEnd}
					  AND ci.hidden = 0
					  AND NOT EXISTS (SELECT 1 FROM Recurrence r WHERE r.owner_id = ci.ROWID)
					  ${calClause}
					  ${searchClause}
				`);

				// ── Source 2: expand recurring events from Recurrence table
				ctx.ui.setStatus("maccalendar", "Expanding recurring events…");
				const recurring = await getExpandedRecurrences(rangeStart, rangeEnd, calFilter, search);

				ctx.ui.setStatus("maccalendar", "");

				// ── Merge + deduplicate by ROWID+ev_start, then sort
				const seen = new Set<string>();
				const all: ExpandedEvent[] = [];

				for (const ev of [...nonRecurring, ...recurring]) {
					const key = `${ev.ROWID}:${ev.ev_start}`;
					if (!seen.has(key)) {
						seen.add(key);
						all.push(ev);
					}
				}

				all.sort((a, b) => a.ev_start - b.ev_start);
				const results = all.slice(0, limit);

				if (!results.length) {
					return { content: [{ type: "text", text: "No events found in the specified range." }] };
				}

				const lines = results.map((r, i) => {
					const start   = formatDate(r.ev_start, r.all_day === 1);
					const end     = formatDate(r.ev_end,   r.all_day === 1);
					const timeStr = r.all_day === 1 ? `${start} (all day)` : `${start} → ${end}`;
					const loc     = r.loc_title || r.loc_address
						? `\n   📍 ${[r.loc_title, r.loc_address].filter(Boolean).join(" — ")}` : "";
					const conf    = r.conference_url ? `\n   🎥 ${r.conference_url}` : "";
					const people  = r.attendee_count > 0 ? `\n   👥 ${r.attendee_count} attendees` : "";
					return `${i + 1}. [id:${r.ROWID}] ${r.summary}\n   🗓 ${r.calendar_name}  |  ${timeStr}${loc}${conf}${people}`;
				});

				const rangeDesc = p.start_date
					? `${p.start_date} → ${p.end_date ?? "+"}`
					: (p.days_back ?? 0) > 0
						? `past ${p.days_back} day(s) + next ${p.days_ahead ?? 7} day(s)`
						: `next ${p.days_ahead ?? 7} day(s)`;

				return {
					content: [{ type: "text", text: `${results.length} event(s) — ${rangeDesc}:\n\n` + lines.join("\n\n") }],
					details: { events: results },
				};
			} catch (err) {
				ctx.ui.setStatus("maccalendar", "");
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	});

	// ── Get Event ───────────────────────────────────────────────────────────

	pi.registerTool({
		name: "calendar_db_get_event",
		label: "Calendar DB: Get Event",
		description:
			"Get full details of a calendar event by its ID, including description, " +
			"location, conference URL, and attendee list. " +
			"Use calendar_db_list_events first to find the event ID.",
		promptSnippet: "Get full details of a calendar event by ID",
		parameters: Type.Object({
			event_id: Type.Integer({ description: "Event ROWID from calendar_db_list_events" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("maccalendar", "Fetching event…");
				const rowid = (params as any).event_id as number;

				const rows = await queryDb<ExpandedEvent & { occurrence_start: number; occurrence_end: number }>(`
					SELECT ci.ROWID,
					       ci.summary,
					       ci.start_date    AS occurrence_start,
					       ci.end_date      AS occurrence_end,
					       ci.all_day,
					       c.title          AS calendar_name,
					       l.title          AS loc_title,
					       l.address        AS loc_address,
					       ci.description,
					       ci.conference_url,
					       (SELECT COUNT(*) FROM Participant pr WHERE pr.owner_id = ci.ROWID) AS attendee_count
					FROM CalendarItem ci
					JOIN Calendar c      ON ci.calendar_id  = c.ROWID
					LEFT JOIN Location l ON l.item_owner_id = ci.ROWID
					WHERE ci.ROWID = ${rowid}
					LIMIT 1
				`);

				if (!rows.length) {
					ctx.ui.setStatus("maccalendar", "");
					return { content: [{ type: "text", text: `No event found with id ${rowid}.` }], isError: true };
				}

				const ev = rows[0];
				const attendees = await queryDb<AttendeeRow>(`
					SELECT email, comment, status, is_self
					FROM Participant WHERE owner_id = ${rowid}
					ORDER BY is_self DESC, email
				`);
				ctx.ui.setStatus("maccalendar", "");

				const statusLabel = (s: number) =>
					(["Unknown", "Accepted", "Declined", "Tentative", "Delegated", "Completed", "In Process"] as const)[s] ?? "Unknown";

				const start = formatDate(ev.occurrence_start, ev.all_day === 1);
				const end   = formatDate(ev.occurrence_end,   ev.all_day === 1);

				const lines = [
					`Title:    ${ev.summary}`,
					`Calendar: ${ev.calendar_name}`,
					`Start:    ${start}`,
					`End:      ${end}`,
					...(ev.all_day ? ["All Day:  Yes"] : []),
					...(ev.loc_title || ev.loc_address
						? [`Location: ${[ev.loc_title, ev.loc_address].filter(Boolean).join(" — ")}`] : []),
					...(ev.conference_url ? [`Meeting:  ${ev.conference_url}`] : []),
					...(attendees.length
						? [`\nAttendees (${attendees.length}):`,
							...attendees.map((a) => {
								const name = a.comment ? `${a.comment} <${a.email}>` : a.email;
								return `  • ${name}${a.is_self ? " (you)" : ""} — ${statusLabel(a.status)}`;
							})]
						: []),
					...(ev.description?.trim() ? [`\nDescription:\n${ev.description.trim()}`] : []),
				];

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { event: ev, attendees },
				};
			} catch (err) {
				ctx.ui.setStatus("maccalendar", "");
				return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
			}
		},
	});
}
