/**
 * OpenWeatherMap Extension
 *
 * Provides weather forecast tools using the free OpenWeatherMap APIs:
 *   - Current Weather API (/data/2.5/weather)
 *   - 5-Day / 3-Hour Forecast API (/data/2.5/forecast)
 *
 * Geocoding by location name uses OpenStreetMap Nominatim (no key required).
 *
 * Setup:
 *   export OPENWEATHERMAP_API_KEY=your_api_key_here
 *
 * Get a free API key at: https://openweathermap.org/api
 *
 * Tools registered:
 *   - owm_weather_forecast: Get weather forecast by city/location name
 *   - owm_weather_forecast_by_coords: Get weather forecast by lat/lon coordinates
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const OWM_CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather";
const OWM_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// --- Types ---

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
}

interface OWMWeather {
	id: number;
	main: string;
	description: string;
	icon: string;
}

interface OWMCurrentResponse {
	dt: number;
	name: string;
	timezone: number; // UTC offset in seconds
	weather: OWMWeather[];
	main: {
		temp: number;
		feels_like: number;
		temp_min: number;
		temp_max: number;
		pressure: number;
		humidity: number;
	};
	visibility?: number;
	wind: { speed: number; deg: number; gust?: number };
	clouds: { all: number };
	rain?: { "1h"?: number };
	snow?: { "1h"?: number };
	sys: { sunrise: number; sunset: number; country?: string };
}

interface OWMForecastItem {
	dt: number;
	dt_txt: string;
	weather: OWMWeather[];
	main: {
		temp: number;
		feels_like: number;
		temp_min: number;
		temp_max: number;
		pressure: number;
		humidity: number;
	};
	wind: { speed: number; deg: number; gust?: number };
	clouds: { all: number };
	visibility?: number;
	pop?: number;
	rain?: { "3h"?: number };
	snow?: { "3h"?: number };
	sys: { pod: string }; // "d" or "n"
}

interface OWMForecastResponse {
	list: OWMForecastItem[];
	city: {
		name: string;
		country: string;
		timezone: number; // UTC offset in seconds
		sunrise: number;
		sunset: number;
	};
}

interface DailySummary {
	localDt: number; // representative Unix timestamp (shifted to local)
	tempMin: number;
	tempMax: number;
	description: string;
	pop: number;
	windSpeed: number;
	windDeg: number;
	humidity: number;
	sunrise: number;
	sunset: number;
}

// --- Helpers ---

function getApiKey(): string | undefined {
//	return process.env.OPENWEATHERMAP_API_KEY;
	return "Your-API-Key-Goes-Here";
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	const res = await fetch(url, { headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

async function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
	const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
	const results = await fetchJson<NominatimResult[]>(url, {
		"User-Agent": "pi-weather-extension/1.0",
		"Accept-Language": "en",
	});
	if (!results.length) return null;
	return {
		lat: parseFloat(results[0].lat),
		lon: parseFloat(results[0].lon),
		label: results[0].display_name,
	};
}

async function fetchCurrent(lat: number, lon: number, apiKey: string, units: string): Promise<OWMCurrentResponse> {
	const params = new URLSearchParams({ lat: String(lat), lon: String(lon), appid: apiKey, units, lang: "en" });
	return fetchJson<OWMCurrentResponse>(`${OWM_CURRENT_URL}?${params}`);
}

async function fetchForecast(lat: number, lon: number, apiKey: string, units: string): Promise<OWMForecastResponse> {
	const params = new URLSearchParams({ lat: String(lat), lon: String(lon), appid: apiKey, units, lang: "en", cnt: "40" });
	return fetchJson<OWMForecastResponse>(`${OWM_FORECAST_URL}?${params}`);
}

// Group 3-hour forecast slots into daily summaries
function aggregateDaily(list: OWMForecastItem[], offsetSecs: number, sunrise: number, sunset: number): DailySummary[] {
	const byDay = new Map<string, OWMForecastItem[]>();
	for (const item of list) {
		// Shift dt to local time, interpret as UTC to extract local date components
		const localDt = new Date((item.dt + offsetSecs) * 1000);
		const key = `${localDt.getUTCFullYear()}-${localDt.getUTCMonth()}-${localDt.getUTCDate()}`;
		if (!byDay.has(key)) byDay.set(key, []);
		byDay.get(key)!.push(item);
	}

	const days: DailySummary[] = [];
	for (const items of byDay.values()) {
		// Pick the slot closest to noon local time as the representative for description/wind
		const noon = items.reduce((best, cur) => {
			const ch = new Date((cur.dt + offsetSecs) * 1000).getUTCHours();
			const bh = new Date((best.dt + offsetSecs) * 1000).getUTCHours();
			return Math.abs(ch - 12) < Math.abs(bh - 12) ? cur : best;
		});

		days.push({
			localDt: items[0].dt + offsetSecs,
			tempMin: Math.min(...items.map((i) => i.main.temp_min)),
			tempMax: Math.max(...items.map((i) => i.main.temp_max)),
			description: noon.weather[0]?.description ?? "",
			pop: Math.max(...items.map((i) => i.pop ?? 0)),
			windSpeed: items.reduce((s, i) => s + i.wind.speed, 0) / items.length,
			windDeg: noon.wind.deg,
			humidity: noon.main.humidity,
			sunrise,
			sunset,
		});
	}
	return days;
}

function bearingToDirection(deg: number): string {
	const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
	return dirs[Math.round(deg / 22.5) % 16];
}

function formatTemp(val: number | undefined, unit: string): string {
	if (val === undefined) return "N/A";
	return `${Math.round(val)}${unit}`;
}

// Format Unix UTC timestamp using a fixed offset (seconds), displayed as local time
function formatTimeWithOffset(unix: number, offsetSecs: number): string {
	return new Date((unix + offsetSecs) * 1000).toLocaleTimeString("en-US", {
		timeZone: "UTC",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDateWithOffset(localDt: number): string {
	return new Date(localDt * 1000).toLocaleDateString("en-US", {
		timeZone: "UTC",
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function formatDatetimeWithOffset(unix: number, offsetSecs: number): string {
	return new Date((unix + offsetSecs) * 1000).toLocaleString("en-US", {
		timeZone: "UTC",
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// --- Formatters ---

function formatCurrent(location: string, data: OWMCurrentResponse, tempUnit: string, speedUnit: string): string {
	const tz = data.timezone;
	const lines = [`Current conditions in ${location}:`];
	if (data.weather[0]) lines.push(`  ${data.weather[0].description}`);
	lines.push(`  Temperature: ${formatTemp(data.main.temp, tempUnit)} (feels like ${formatTemp(data.main.feels_like, tempUnit)})`);
	lines.push(`  Humidity: ${data.main.humidity}%`);
	{
		const dir = ` ${bearingToDirection(data.wind.deg)}`;
		const gust = data.wind.gust != null ? `, gusts ${Math.round(data.wind.gust)} ${speedUnit}` : "";
		lines.push(`  Wind: ${Math.round(data.wind.speed)} ${speedUnit}${dir}${gust}`);
	}
	if (data.rain?.["1h"]) lines.push(`  Rain (last 1h): ${data.rain["1h"]} mm`);
	if (data.snow?.["1h"]) lines.push(`  Snow (last 1h): ${data.snow["1h"]} mm`);
	lines.push(`  Cloud cover: ${data.clouds.all}%`);
	if (data.visibility !== undefined) lines.push(`  Visibility: ${(data.visibility / 1000).toFixed(1)} km`);
	lines.push(`  Sunrise: ${formatTimeWithOffset(data.sys.sunrise, tz)}  Sunset: ${formatTimeWithOffset(data.sys.sunset, tz)}`);
	return lines.join("\n");
}

function formatDaily(location: string, days: DailySummary[], offsetSecs: number, tempUnit: string, speedUnit: string): string {
	const lines = [`${days.length}-day forecast for ${location}:\n`];
	for (const day of days) {
		const date = formatDateWithOffset(day.localDt);
		const high = formatTemp(day.tempMax, tempUnit);
		const low = formatTemp(day.tempMin, tempUnit);
		lines.push(`${date}: ${low} – ${high}${day.description ? `  ${day.description}` : ""}`);
		if (day.pop > 0) lines.push(`  Precip: ${Math.round(day.pop * 100)}%`);
		const dir = ` ${bearingToDirection(day.windDeg)}`;
		lines.push(`  Wind: ${Math.round(day.windSpeed)} ${speedUnit}${dir}`);
		lines.push(`  Sunrise: ${formatTimeWithOffset(day.sunrise, offsetSecs)}  Sunset: ${formatTimeWithOffset(day.sunset, offsetSecs)}`);
	}
	return lines.join("\n");
}

function formatHourly(location: string, list: OWMForecastItem[], offsetSecs: number, count: number, tempUnit: string, speedUnit: string): string {
	// Slots are every 3 hours; each "count" hour maps to ceil(count/3) slots
	const slotCount = Math.min(Math.ceil(count / 3), list.length);
	const lines = [`${slotCount * 3}-hour forecast for ${location} (3-hour intervals):\n`];
	for (let i = 0; i < slotCount; i++) {
		const item = list[i];
		const time = formatDatetimeWithOffset(item.dt, offsetSecs);
		const temp = formatTemp(item.main.temp, tempUnit);
		const desc = item.weather[0]?.description ?? "";
		let extra = desc;
		const pop = item.pop ?? 0;
		if (pop > 0.05) {
			const precip = item.rain?.["3h"] != null ? ` rain ${item.rain["3h"]}mm` : item.snow?.["3h"] != null ? ` snow ${item.snow["3h"]}mm` : "";
			extra += ` | Precip: ${Math.round(pop * 100)}%${precip}`;
		}
		const dir = ` ${bearingToDirection(item.wind.deg)}`;
		extra += ` | Wind: ${Math.round(item.wind.speed)} ${speedUnit}${dir}`;
		lines.push(`${time}: ${temp}${extra ? `  — ${extra.trim()}` : ""}`);
	}
	return lines.join("\n");
}

// --- Extension ---

export default function openWeatherMapExtension(pi: ExtensionAPI) {
	async function runForecast(
		lat: number,
		lon: number,
		locationLabel: string,
		type: "current" | "daily" | "hourly",
		metric: boolean,
		hourCount: number,
		apiKey: string,
		ctx: { ui: { setStatus: (k: string, v: string) => void } },
	): Promise<string> {
		const units = metric ? "metric" : "imperial";
		const tempUnit = metric ? "°C" : "°F";
		const speedUnit = metric ? "m/s" : "mph";

		ctx.ui.setStatus("openweathermap", `Fetching ${type} forecast for ${locationLabel}...`);

		let text: string;
		if (type === "current") {
			const data = await fetchCurrent(lat, lon, apiKey, units);
			text = formatCurrent(locationLabel, data, tempUnit, speedUnit);
		} else {
			const data = await fetchForecast(lat, lon, apiKey, units);
			const offsetSecs = data.city.timezone;
			if (type === "daily") {
				const days = aggregateDaily(data.list, offsetSecs, data.city.sunrise, data.city.sunset);
				text = formatDaily(locationLabel, days, offsetSecs, tempUnit, speedUnit);
			} else {
				text = formatHourly(locationLabel, data.list, offsetSecs, hourCount, tempUnit, speedUnit);
			}
		}

		ctx.ui.setStatus("openweathermap", "");
		return text;
	}

	// Tool: forecast by location name
	pi.registerTool({
		name: "owm_weather_forecast",
		label: "Weather Forecast (OpenWeatherMap)",
		description:
			"Get weather forecast for a location by name using the free OpenWeatherMap API. Returns current conditions, daily (5-day), or 3-hourly forecasts. Use whenever the user asks about weather, temperature, rain, or conditions for a place.",
		promptSnippet: "Get OpenWeatherMap forecast for a city or location",
		parameters: Type.Object({
			location: Type.String({ description: "City or location name, e.g. 'Paris', 'New York, NY', 'London, UK'" }),
			type: Type.Optional(
				Type.Union([Type.Literal("current"), Type.Literal("daily"), Type.Literal("hourly")], {
					description: "Forecast type: 'current' for now, 'daily' (default) for 5-day, 'hourly' for 3-hour intervals (up to 5 days)",
				})
			),
			hours: Type.Optional(Type.Number({ description: "Number of hours for hourly forecast (max 120, rounded to 3-hour slots). Default: 24" })),
			metric: Type.Optional(Type.Boolean({ description: "Use metric units (°C, m/s). Default: false (imperial)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const apiKey = getApiKey();
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "OPENWEATHERMAP_API_KEY environment variable is not set. Get a free key at https://openweathermap.org/api and restart pi." }],
					details: { error: "missing_api_key" },
				};
			}

			const { location, type = "daily", hours = 24, metric = false } = params as {
				location: string;
				type?: "current" | "daily" | "hourly";
				hours?: number;
				metric?: boolean;
			};

			ctx.ui.setStatus("openweathermap", `Geocoding "${location}"...`);
			const geo = await geocode(location);
			ctx.ui.setStatus("openweathermap", "");

			if (!geo) {
				return {
					content: [{ type: "text", text: `No location found for "${location}". Try a more specific query.` }],
					details: { error: "location_not_found" },
				};
			}

			const text = await runForecast(geo.lat, geo.lon, geo.label, type, metric, hours, apiKey, ctx);
			return {
				content: [{ type: "text", text }],
				details: { location: geo.label, lat: geo.lat, lon: geo.lon, type, metric },
			};
		},
	});

	// Tool: forecast by coordinates
	pi.registerTool({
		name: "owm_weather_forecast_by_coords",
		label: "Weather Forecast by Coords (OpenWeatherMap)",
		description:
			"Get weather forecast by geographic coordinates (latitude/longitude) using the free OpenWeatherMap API. Use when coordinates are already known.",
		parameters: Type.Object({
			latitude: Type.Number({ description: "Latitude (e.g. 48.8566)" }),
			longitude: Type.Number({ description: "Longitude (e.g. 2.3522)" }),
			location_name: Type.Optional(Type.String({ description: "Optional display name for the location" })),
			type: Type.Optional(
				Type.Union([Type.Literal("current"), Type.Literal("daily"), Type.Literal("hourly")], {
					description: "Forecast type: 'current', 'daily' (default), or 'hourly'",
				})
			),
			hours: Type.Optional(Type.Number({ description: "Number of hours for hourly forecast (max 120). Default: 24" })),
			metric: Type.Optional(Type.Boolean({ description: "Use metric units. Default: false (imperial)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const apiKey = getApiKey();
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "OPENWEATHERMAP_API_KEY environment variable is not set. Get a free key at https://openweathermap.org/api and restart pi." }],
					details: { error: "missing_api_key" },
				};
			}

			const { latitude, longitude, location_name, type = "daily", hours = 24, metric = false } = params as {
				latitude: number;
				longitude: number;
				location_name?: string;
				type?: "current" | "daily" | "hourly";
				hours?: number;
				metric?: boolean;
			};

			const locationLabel = location_name ?? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
			const text = await runForecast(latitude, longitude, locationLabel, type, metric, hours, apiKey, ctx);
			return {
				content: [{ type: "text", text }],
				details: { location: locationLabel, lat: latitude, lon: longitude, type, metric },
			};
		},
	});
}
