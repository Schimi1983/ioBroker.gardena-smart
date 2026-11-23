/*
 * Schedules and schedule pause of first generation (lemonbeat) devices.
 *
 * @KI_HINWEIS: Formats verified on a Water Control 18869 (gateway firmware 10.14.1) by changing values in the
 * GARDENA app and reading the raw values:
 * - action_paused_until_N: 6 bytes, year (little endian), month, day, hour, minute in the device's local time
 *   (device/0/utc_offset). Empty = not paused. "Permanently" in the app = 2038-01-18 01:00.
 * - schedule_config: 7 bytes per schedule: id, weekday bit mask (0x7F = every day), hour, minute,
 *   duration in minutes (2 bytes little endian, assumed), 1 byte unknown. The id changes when the app saves.
 */

/** Year from which a pause counts as "permanent" */
const PERMANENT_YEAR = 2038;
/** Value the GARDENA app writes for "permanently" */
const PERMANENT = { year: 2038, month: 1, day: 18, hour: 1, minute: 0 };

/** One schedule of a valve */
export interface ScheduleEntry {
	/** internal id (changes when the schedule is saved in the app) */
	id: number;
	/** weekdays as bit mask, 0x7F = every day */
	days: number;
	/** start time "HH:MM" (local time of the device) */
	start: string;
	/** end time "HH:MM" */
	end: string;
	/** duration in minutes */
	minutes: number;
}

/** State of the schedule pause */
export interface PauseState {
	/** schedules are paused */
	paused: boolean;
	/** paused until (ms), 0 if not paused */
	until: number;
	/** paused without end */
	permanent: boolean;
}

/**
 * Parses the device time zone, e.g. "UTC+01:00".
 *
 * @param text value of device/0/utc_offset
 * @returns offset to UTC in minutes (0 if unknown)
 */
export function parseUtcOffset(text: unknown): number {
	const m = typeof text === 'string' ? /^UTC([+-])(\d{1,2}):?(\d{2})?$/.exec(text.trim()) : null;
	if (!m) {
		return 0;
	}
	const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
	return m[1] === '-' ? -minutes : minutes;
}

/**
 * Decodes `action_paused_until_N`.
 *
 * @param base64 raw value (opaque, base64)
 * @param offsetMinutes device time zone (minutes east of UTC)
 * @returns pause state, null if the value is unknown/invalid
 */
export function decodePause(base64: unknown, offsetMinutes: number): PauseState | null {
	if (base64 === '') {
		return { paused: false, until: 0, permanent: false };
	}
	if (typeof base64 !== 'string') {
		return null;
	}
	const b = Buffer.from(base64, 'base64');
	if (b.length < 6) {
		return null;
	}
	const year = b[0] | (b[1] << 8);
	const until = Date.UTC(year, b[2] - 1, b[3], b[4], b[5]) - offsetMinutes * 60_000;
	if (!Number.isFinite(until)) {
		return null;
	}
	return { paused: true, until, permanent: year >= PERMANENT_YEAR };
}

/**
 * Encodes a pause for `action_paused_until_N`.
 *
 * @param until end of the pause (ms), `'permanent'` or 0 to resume
 * @param offsetMinutes device time zone (minutes east of UTC)
 * @returns base64 value to write
 */
export function encodePause(until: number | 'permanent', offsetMinutes: number): string {
	if (until === 0) {
		return '';
	}
	let p: { year: number; month: number; day: number; hour: number; minute: number };
	if (until === 'permanent') {
		p = PERMANENT;
	} else {
		const local = new Date(until + offsetMinutes * 60_000);
		p = {
			year: local.getUTCFullYear(),
			month: local.getUTCMonth() + 1,
			day: local.getUTCDate(),
			hour: local.getUTCHours(),
			minute: local.getUTCMinutes(),
		};
	}
	return Buffer.from([p.year & 0xff, p.year >> 8, p.month, p.day, p.hour, p.minute]).toString('base64');
}

/**
 * Decodes `schedule_config`.
 *
 * @param base64 raw value (opaque, base64)
 * @returns schedules, empty if there are none or the value is invalid
 */
export function decodeSchedules(base64: unknown): ScheduleEntry[] {
	if (typeof base64 !== 'string' || !base64) {
		return [];
	}
	const b = Buffer.from(base64, 'base64');
	const list: ScheduleEntry[] = [];
	for (let i = 0; i + 7 <= b.length; i += 7) {
		const hour = b[i + 2];
		const minute = b[i + 3];
		const minutes = b[i + 4] | (b[i + 5] << 8);
		if (hour > 23 || minute > 59) {
			return [];
		}
		const endMin = (hour * 60 + minute + minutes) % 1440;
		list.push({
			id: b[i],
			days: b[i + 1],
			start: hhmm(hour * 60 + minute),
			end: hhmm(endMin),
			minutes,
		});
	}
	return list;
}

function hhmm(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
