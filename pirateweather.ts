/**
 * Pirate Weather Extension
 *
 * Provides weather forecast tools using the Pirate Weather API (pirate-weather.apiable.io).
 * Geocoding by location name uses OpenStreetMap Nominatim (no key required).
 *
 * Setup:
 *   export PIRATE_WEATHER_API_KEY=your_api_key_here
 *
 * Get a free API key at: https://pirateweather.net/
 *
 * Tools registered:
 *   - weather_forecast: Get weather forecast by city/location name
 *   - weather_forecast_by_coords: Get weather forecast by lat/lon coordinates
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const PIRATE_BASE_URL = "https://api.pirateweather.net/forecast";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// --- Types ---

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
}

interface DataPoint {
	time: number;
	summary?: string;
	icon?: string;
	temperature?: number;
	apparentTemperature?: number;
	humidity?: number;
	windSpeed?: number;
	windGust?: number;
	windBearing?: number;
	precipIntensity?: number;
	precipProbability?: number;
	precipType?: string;
	cloudCover?: number;
	uvIndex?: number;
	visibility?: number;
	pressure?: number;
	dewPoint?: number;
	// Daily-only
	temperatureHigh?: number;
	temperatureLow?: number;
	temperatureMax?: number;
	temperatureMin?: number;
	sunriseTime?: number;
	sunsetTime?: number;
}

interface ForecastResponse {
	latitude: number;
	longitude: number;
	timezone: string;
	currently?: DataPoint;
	hourly?: { summary?: string; data: DataPoint[] };
	daily?: { summary?: string; data: DataPoint[] };
	alerts?: { title: string; severity: string; description: string; expires: number }[];
}

// --- Helpers ---

function getApiKey(): string | undefined {
	return process.env.PIRATE_WEATHER_API_KEY;
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

async function getForecast(
	lat: number,
	lon: number,
	apiKey: string,
	units: string,
	extend: boolean,
	exclude: string[],
): Promise<ForecastResponse> {
	const params = new URLSearchParams({ units });
	if (extend) params.set("extend", "hourly");
	if (exclude.length) params.set("exclude", exclude.join(","));
	const url = `${PIRATE_BASE_URL}/${apiKey}/${lat},${lon}?${params}`;
	return fetchJson<ForecastResponse>(url);
}

function bearingToDirection(deg: number): string {
	const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
	return dirs[Math.round(deg / 22.5) % 16];
}

function formatTemp(val: number | undefined, unit: string): string {
	if (val === undefined) return "N/A";
	return `${Math.round(val)}${unit}`;
}

function formatTime(unix: number, timezone: string): string {
	return new Date(unix * 1000).toLocaleTimeString("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDate(unix: number, timezone: string): string {
	return new Date(unix * 1000).toLocaleDateString("en-US", {
		timeZone: timezone,
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function formatDatetime(unix: number, timezone: string): string {
	return new Date(unix * 1000).toLocaleString("en-US", {
		timeZone: timezone,
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// --- Formatters ---

function formatCurrent(location: string, point: DataPoint, timezone: string, tempUnit: string, speedUnit: string): string {
	const lines = [`Current conditions in ${location}:`];
	if (point.summary) lines.push(`  ${point.summary}`);
	lines.push(`  Temperature: ${formatTemp(point.temperature, tempUnit)} (feels like ${formatTemp(point.apparentTemperature, tempUnit)})`);
	if (point.humidity !== undefined) lines.push(`  Humidity: ${Math.round(point.humidity * 100)}%`);
	if (point.windSpeed !== undefined) {
		const dir = point.windBearing !== undefined ? ` ${bearingToDirection(point.windBearing)}` : "";
		const gust = point.windGust !== undefined ? `, gusts ${Math.round(point.windGust)} ${speedUnit}` : "";
		lines.push(`  Wind: ${Math.round(point.windSpeed)} ${speedUnit}${dir}${gust}`);
	}
	if (point.precipProbability !== undefined && point.precipProbability > 0) {
		const type = point.precipType ? ` (${point.precipType})` : "";
		lines.push(`  Precipitation: ${Math.round(point.precipProbability * 100)}% chance${type}`);
	}
	if (point.cloudCover !== undefined) lines.push(`  Cloud cover: ${Math.round(point.cloudCover * 100)}%`);
	if (point.uvIndex !== undefined) lines.push(`  UV Index: ${point.uvIndex}`);
	if (point.visibility !== undefined) lines.push(`  Visibility: ${Math.round(point.visibility)} km`);
	return lines.join("\n");
}

function formatDaily(location: string, data: DataPoint[], timezone: string, tempUnit: string, speedUnit: string): string {
	const lines = [`${data.length}-day forecast for ${location}:\n`];
	for (const day of data) {
		const date = formatDate(day.time, timezone);
		const high = formatTemp(day.temperatureHigh ?? day.temperatureMax, tempUnit);
		const low = formatTemp(day.temperatureLow ?? day.temperatureMin, tempUnit);
		lines.push(`${date}: ${low} – ${high}${day.summary ? `  ${day.summary}` : ""}`);
		if (day.precipProbability !== undefined && day.precipProbability > 0) {
			const type = day.precipType ? ` ${day.precipType}` : "";
			lines.push(`  Precip: ${Math.round(day.precipProbability * 100)}%${type}`);
		}
		if (day.windSpeed !== undefined) {
			const dir = day.windBearing !== undefined ? ` ${bearingToDirection(day.windBearing)}` : "";
			lines.push(`  Wind: ${Math.round(day.windSpeed)} ${speedUnit}${dir}`);
		}
	}
	return lines.join("\n");
}

function formatHourly(location: string, data: DataPoint[], timezone: string, tempUnit: string, speedUnit: string): string {
	const lines = [`${data.length}-hour forecast for ${location}:\n`];
	for (const hour of data) {
		const time = formatDatetime(hour.time, timezone);
		const temp = formatTemp(hour.temperature, tempUnit);
		let extra = hour.summary ? `${hour.summary}` : "";
		if (hour.precipProbability !== undefined && hour.precipProbability > 0.05) {
			const type = hour.precipType ? ` ${hour.precipType}` : "";
			extra += ` | Precip: ${Math.round(hour.precipProbability * 100)}%${type}`;
		}
		if (hour.windSpeed !== undefined) {
			const dir = hour.windBearing !== undefined ? ` ${bearingToDirection(hour.windBearing)}` : "";
			extra += ` | Wind: ${Math.round(hour.windSpeed)} ${speedUnit}${dir}`;
		}
		lines.push(`${time}: ${temp}${extra ? `  — ${extra.trim()}` : ""}`);
	}
	return lines.join("\n");
}

// --- Extension ---

export default function pirateWeatherExtension(pi: ExtensionAPI) {
	// Shared execution logic
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
		const units = metric ? "si" : "us";
		const tempUnit = metric ? "°C" : "°F";
		const speedUnit = metric ? "km/h" : "mph";

		// Only request the block we need
		const allBlocks = ["currently", "minutely", "hourly", "daily", "alerts"];
		let exclude: string[];
		let extend = false;

		if (type === "current") {
			exclude = allBlocks.filter((b) => b !== "currently");
		} else if (type === "hourly") {
			exclude = allBlocks.filter((b) => b !== "hourly");
			extend = hourCount > 48;
		} else {
			exclude = allBlocks.filter((b) => b !== "daily");
		}

		ctx.ui.setStatus("pirate-weather", `Fetching ${type} forecast for ${locationLabel}...`);
		const forecast = await getForecast(lat, lon, apiKey, units, extend, exclude);
		ctx.ui.setStatus("pirate-weather", "");

		const tz = forecast.timezone;

		if (type === "current") {
			if (!forecast.currently) throw new Error("No current conditions in response");
			return formatCurrent(locationLabel, forecast.currently, tz, tempUnit, speedUnit);
		} else if (type === "hourly") {
			if (!forecast.hourly?.data.length) throw new Error("No hourly data in response");
			const slice = forecast.hourly.data.slice(0, hourCount);
			return formatHourly(locationLabel, slice, tz, tempUnit, speedUnit);
		} else {
			if (!forecast.daily?.data.length) throw new Error("No daily data in response");
			return formatDaily(locationLabel, forecast.daily.data, tz, tempUnit, speedUnit);
		}
	}

	// Tool: forecast by location name
	pi.registerTool({
		name: "weather_forecast",
		label: "Weather Forecast",
		description:
			"Get weather forecast for a location by name using Pirate Weather. Returns current conditions, daily (7-day), or hourly forecasts. Use whenever the user asks about weather, temperature, rain, or conditions for a place.",
		promptSnippet: "Get weather forecast for a city or location",
		parameters: Type.Object({
			location: Type.String({ description: "City or location name, e.g. 'Paris', 'New York, NY', 'London, UK'" }),
			type: Type.Optional(
				Type.Union([Type.Literal("current"), Type.Literal("daily"), Type.Literal("hourly")], {
					description: "Forecast type: 'current' for now, 'daily' (default) for 7-day, 'hourly' for hour-by-hour",
				})
			),
			hours: Type.Optional(Type.Number({ description: "Number of hours for hourly forecast (up to 168 with extend). Default: 24" })),
			metric: Type.Optional(Type.Boolean({ description: "Use metric units (°C, km/h). Default: false (imperial)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const apiKey = getApiKey();
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "PIRATE_WEATHER_API_KEY environment variable is not set. Get a free key at https://pirateweather.net/ and restart pi." }],
					details: { error: "missing_api_key" },
				};
			}

			const { location, type = "daily", hours = 24, metric = false } = params as {
				location: string;
				type?: "current" | "daily" | "hourly";
				hours?: number;
				metric?: boolean;
			};

			ctx.ui.setStatus("pirate-weather", `Geocoding "${location}"...`);
			const geo = await geocode(location);
			ctx.ui.setStatus("pirate-weather", "");

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
		name: "weather_forecast_by_coords",
		label: "Weather Forecast (Coords)",
		description:
			"Get weather forecast by geographic coordinates (latitude/longitude) using Pirate Weather. Use when coordinates are already known.",
		parameters: Type.Object({
			latitude: Type.Number({ description: "Latitude (e.g. 48.8566)" }),
			longitude: Type.Number({ description: "Longitude (e.g. 2.3522)" }),
			location_name: Type.Optional(Type.String({ description: "Optional display name for the location" })),
			type: Type.Optional(
				Type.Union([Type.Literal("current"), Type.Literal("daily"), Type.Literal("hourly")], {
					description: "Forecast type: 'current', 'daily' (default), or 'hourly'",
				})
			),
			hours: Type.Optional(Type.Number({ description: "Number of hours for hourly forecast. Default: 24" })),
			metric: Type.Optional(Type.Boolean({ description: "Use metric units. Default: false (imperial)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const apiKey = getApiKey();
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "PIRATE_WEATHER_API_KEY environment variable is not set. Get a free key at https://pirateweather.net/ and restart pi." }],
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
