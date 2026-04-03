/**
 * Mac Calendar Extension for Pi
 *
 * Reads and creates calendar events via the macOS Calendar app using AppleScript.
 * No credentials required — works with any account configured in Calendar
 * (iCloud, Exchange, Google, etc.).
 *
 * Setup:
 *   - macOS Calendar must be installed (will launch automatically if not running)
 *   - Grant Automation permission when macOS prompts: allow Terminal/pi to control Calendar
 *
 * Tools registered:
 *   - calendar_list_calendars: List all calendars
 *   - calendar_list_events:    List events in a date range
 *   - calendar_create_event:   Create a new calendar event
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const EVT_SEP = "<<EVT>>";
const FIELD_SEP = "<<F>>";

function esc(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runScript(script: string): Promise<string> {
	const { stdout } = await execFileAsync("osascript", ["-e", script], {
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout.trimEnd();
}

// Build AppleScript statements to construct a Date value into `varName`
function appleScriptDate(varName: string, year: number, month: number, day: number, hour: number, minute: number): string {
	return `set ${varName} to current date
	set year of ${varName} to ${year}
	set month of ${varName} to ${month}
	set day of ${varName} to ${day}
	set hours of ${varName} to ${hour}
	set minutes of ${varName} to ${minute}
	set seconds of ${varName} to 0`;
}

// Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" into components
function parseISO(s: string): { year: number; month: number; day: number; hour: number; minute: number } {
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
	if (!m) throw new Error(`Invalid date format: "${s}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM`);
	return {
		year: parseInt(m[1]),
		month: parseInt(m[2]),
		day: parseInt(m[3]),
		hour: m[4] ? parseInt(m[4]) : 0,
		minute: m[5] ? parseInt(m[5]) : 0,
	};
}

interface CalendarInfo {
	name: string;
	description: string;
	writable: boolean;
}

interface CalendarEvent {
	uid: string;
	title: string;
	startDate: string;
	endDate: string;
	location: string;
	notes: string;
	calendar: string;
	allDay: boolean;
}

async function listCalendars(): Promise<CalendarInfo[]> {
	const script = `
tell application "Calendar"
	set out to ""
	repeat with cal in every calendar
		set calName to name of cal
		set calDesc to description of cal
		if calDesc is missing value then set calDesc to ""
		set calWritable to writable of cal
		set out to out & calName & "${FIELD_SEP}" & calDesc & "${FIELD_SEP}" & calWritable & "${EVT_SEP}"
	end repeat
	return out
end tell`;
	const raw = await runScript(script);
	if (!raw) return [];
	return raw
		.split(EVT_SEP)
		.filter(Boolean)
		.map((chunk) => {
			const [name, description, writable] = chunk.split(FIELD_SEP);
			return {
				name: name ?? "",
				description: description ?? "",
				writable: writable?.trim() === "true",
			};
		});
}

async function listEvents(startDate: string, endDate: string, calendarName?: string): Promise<CalendarEvent[]> {
	const start = parseISO(startDate);
	// If end date has no time component, extend to end of that day
	const end = parseISO(endDate);
	const endHour = endDate.includes("T") ? end.hour : 23;
	const endMinute = endDate.includes("T") ? end.minute : 59;

	const calFilter = calendarName
		? `if name of cal is "${esc(calendarName)}" then`
		: "if true then";

	const script = `
tell application "Calendar"
	${appleScriptDate("startRange", start.year, start.month, start.day, start.hour, start.minute)}
	${appleScriptDate("endRange", end.year, end.month, end.day, endHour, endMinute)}
	set out to ""
	repeat with cal in every calendar
		${calFilter}
			set calName to name of cal
			set evts to every event of cal
			repeat with evt in evts
				try
					set evtStart to start date of evt
					set evtEnd to end date of evt
					if evtStart <= endRange and evtEnd >= startRange then
						set evtTitle to summary of evt
						if evtTitle is missing value then set evtTitle to "(no title)"
						set evtLoc to location of evt
						if evtLoc is missing value then set evtLoc to ""
						set evtNotes to description of evt
						if evtNotes is missing value then set evtNotes to ""
						set evtUID to uid of evt
						if evtUID is missing value then set evtUID to ""
						set evtAllDay to allday event of evt
						set evtStartStr to evtStart as string
						set evtEndStr to evtEnd as string
						set out to out & evtUID & "${FIELD_SEP}" & evtTitle & "${FIELD_SEP}" & evtStartStr & "${FIELD_SEP}" & evtEndStr & "${FIELD_SEP}" & evtLoc & "${FIELD_SEP}" & evtNotes & "${FIELD_SEP}" & calName & "${FIELD_SEP}" & evtAllDay & "${EVT_SEP}"
					end if
				end try
			end repeat
		end if
	end repeat
	return out
end tell`;

	const raw = await runScript(script);
	if (!raw) return [];
	return raw
		.split(EVT_SEP)
		.filter(Boolean)
		.map((chunk) => {
			const [uid, title, startD, endD, location, notes, calendar, allDay] = chunk.split(FIELD_SEP);
			return {
				uid: uid ?? "",
				title: title ?? "(no title)",
				startDate: startD ?? "",
				endDate: endD ?? "",
				location: location ?? "",
				notes: notes ?? "",
				calendar: calendar ?? "",
				allDay: allDay?.trim() === "true",
			};
		})
		.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

async function createEvent(params: {
	title: string;
	start: string;
	end: string;
	calendarName?: string;
	location?: string;
	notes?: string;
	allDay?: boolean;
}): Promise<{ calendarName: string; uid: string }> {
	const start = parseISO(params.start);
	const end = parseISO(params.end);

	const calClause = params.calendarName
		? `set targetCal to missing value
	repeat with cal in every calendar
		if name of cal is "${esc(params.calendarName)}" then
			set targetCal to cal
			exit repeat
		end if
	end repeat
	if targetCal is missing value then
		return "ERROR: Calendar \\"${esc(params.calendarName)}\\" not found"
	end if`
		: `set targetCal to missing value
	repeat with cal in every calendar
		if writable of cal is true then
			set targetCal to cal
			exit repeat
		end if
	end repeat
	if targetCal is missing value then
		return "ERROR: No writable calendar found"
	end if`;

	const optionalProps = [
		params.location ? `set location of newEvent to "${esc(params.location)}"` : "",
		params.notes ? `set description of newEvent to "${esc(params.notes)}"` : "",
		params.allDay ? `set allday event of newEvent to true` : "",
	].filter(Boolean).join("\n\t");

	const script = `
tell application "Calendar"
	${calClause}
	${appleScriptDate("evtStart", start.year, start.month, start.day, start.hour, start.minute)}
	${appleScriptDate("evtEnd", end.year, end.month, end.day, end.hour, end.minute)}
	set newEvent to make new event at end of events of targetCal with properties {summary:"${esc(params.title)}", start date:evtStart, end date:evtEnd}
	${optionalProps}
	set evtUID to uid of newEvent
	return (name of targetCal) & "${FIELD_SEP}" & evtUID
end tell`;

	const raw = await runScript(script);
	if (raw.startsWith("ERROR:")) throw new Error(raw.slice(7).trim());
	const [calendarName, uid] = raw.split(FIELD_SEP);
	return { calendarName: calendarName ?? "", uid: uid ?? "" };
}

export default function macCalendarExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "calendar_list_calendars",
		label: "Calendar: List Calendars",
		description:
			"List all calendars configured in the macOS Calendar app. Use this to discover calendar names before creating or listing events.",
		promptSnippet: "List calendars in Mac Calendar",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			try {
				const calendars = await listCalendars();
				if (calendars.length === 0) {
					return { content: [{ type: "text", text: "No calendars found in Calendar.app." }] };
				}
				const lines = calendars.map(
					(c, i) =>
						`  ${i + 1}. ${c.name}${c.description ? ` — ${c.description}` : ""}${c.writable ? "" : " (read-only)"}`,
				);
				const text = `Calendars (${calendars.length}):\n` + lines.join("\n");
				return { content: [{ type: "text", text }], details: { calendars } };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "calendar_list_events",
		label: "Calendar: List Events",
		description:
			"List calendar events in a date range from the macOS Calendar app. Works with all accounts " +
			"(iCloud, Exchange, Google, etc.). Use calendar_list_calendars first to find calendar names.",
		promptSnippet: "List calendar events for a date range",
		parameters: Type.Object({
			start_date: Type.Optional(
				Type.String({ description: "Start date in YYYY-MM-DD or YYYY-MM-DDTHH:MM format. Defaults to today." }),
			),
			end_date: Type.Optional(
				Type.String({
					description: "End date in YYYY-MM-DD or YYYY-MM-DDTHH:MM format. Defaults to 7 days after start.",
				}),
			),
			calendar: Type.Optional(
				Type.String({ description: "Calendar name to filter by. Leave blank for all calendars." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("maccalendar", "Reading Calendar...");
				const p = params as { start_date?: string; end_date?: string; calendar?: string };

				const today = new Date();
				const startDate = p.start_date ?? today.toISOString().slice(0, 10);
				const defaultEnd = new Date(today);
				defaultEnd.setDate(defaultEnd.getDate() + 7);
				const endDate = p.end_date ?? defaultEnd.toISOString().slice(0, 10);

				const events = await listEvents(startDate, endDate, p.calendar);
				ctx.ui.setStatus("maccalendar", "");

				if (events.length === 0) {
					const calMsg = p.calendar ? ` in "${p.calendar}"` : "";
					return {
						content: [{ type: "text", text: `No events found between ${startDate} and ${endDate}${calMsg}.` }],
					};
				}

				const lines = events.map((e, i) => {
					const timeRange = e.allDay ? "All day" : `${e.startDate} – ${e.endDate}`;
					const loc = e.location ? `\n   Location: ${e.location}` : "";
					const notes = e.notes ? `\n   Notes: ${e.notes.slice(0, 80)}${e.notes.length > 80 ? "…" : ""}` : "";
					return `${i + 1}. ${e.title}\n   ${timeRange}\n   Calendar: ${e.calendar}${loc}${notes}`;
				});
				const text = `${events.length} event(s) from ${startDate} to ${endDate}:\n\n` + lines.join("\n\n");
				return { content: [{ type: "text", text }], details: { events } };
			} catch (err) {
				ctx.ui.setStatus("maccalendar", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "calendar_create_event",
		label: "Calendar: Create Event",
		description:
			"Create a new event in the macOS Calendar app. Use calendar_list_calendars first to find the exact calendar name. " +
			"Defaults to the first writable calendar if none is specified.",
		promptSnippet: "Create a calendar event",
		parameters: Type.Object({
			title: Type.String({ description: "Event title" }),
			start: Type.String({ description: "Start datetime in YYYY-MM-DDTHH:MM format (e.g. '2026-04-10T09:00')" }),
			end: Type.String({ description: "End datetime in YYYY-MM-DDTHH:MM format (e.g. '2026-04-10T10:00')" }),
			calendar: Type.Optional(
				Type.String({ description: "Calendar name. Defaults to the first writable calendar." }),
			),
			location: Type.Optional(Type.String({ description: "Event location" })),
			notes: Type.Optional(Type.String({ description: "Event notes or description" })),
			all_day: Type.Optional(Type.Boolean({ description: "Mark as an all-day event (default: false)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				ctx.ui.setStatus("maccalendar", "Creating event...");
				const p = params as {
					title: string;
					start: string;
					end: string;
					calendar?: string;
					location?: string;
					notes?: string;
					all_day?: boolean;
				};

				const result = await createEvent({
					title: p.title,
					start: p.start,
					end: p.end,
					calendarName: p.calendar,
					location: p.location,
					notes: p.notes,
					allDay: p.all_day,
				});
				ctx.ui.setStatus("maccalendar", "");

				const text =
					`Event created!\n` +
					`  Title:    ${p.title}\n` +
					`  Start:    ${p.start}\n` +
					`  End:      ${p.end}\n` +
					`  Calendar: ${result.calendarName}\n` +
					(p.location ? `  Location: ${p.location}\n` : "") +
					`  UID:      ${result.uid}`;

				return {
					content: [{ type: "text", text }],
					details: { title: p.title, start: p.start, end: p.end, calendar: result.calendarName, uid: result.uid },
				};
			} catch (err) {
				ctx.ui.setStatus("maccalendar", "");
				const msg = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
			}
		},
	});
}
