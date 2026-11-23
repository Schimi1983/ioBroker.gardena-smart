/*
 * Counts the requests sent to the GARDENA smart system cloud API.
 *
 * @KI_HINWEIS: The cloud offers no endpoint to read the used quota. The adapter therefore counts its own
 * requests over a rolling window of 7 days. Requests of other programs using the same App Key (e.g. a second
 * ioBroker instance or Home Assistant) are not included.
 */

/** Default weekly limit of the GARDENA smart system API per App Key (shown in the Developer Portal) */
export const WEEKLY_LIMIT = 1000;
/** Length of the rolling window */
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Usage in percent from which a warning is shown */
export const WARNING_PERCENT = 80;

/**
 * Importance of a cloud request.
 * - `background`: automatic requests (e.g. reading names) – stop early to keep a reserve
 * - `command`: requests triggered by the user – may use the reserve
 */
export type RequestPriority = 'background' | 'command';
/** Share of the weekly limit kept free for user commands (percent) */
export const COMMAND_RESERVE_PERCENT = 10;

/** Summary of the quota, as shown in the states */
export interface QuotaSummary {
	/** requests in the last 7 days */
	used: number;
	/** weekly limit */
	limit: number;
	/** requests left */
	remaining: number;
	/** used share in percent (0–100) */
	percent: number;
	/** usage reached the warning threshold */
	warning: boolean;
	/** time (ms) until the oldest request leaves the window, null if no request was counted */
	nextRelease: number | null;
}

/**
 * Rolling 7 day request counter.
 */
export class QuotaCounter {
	private stamps: number[] = [];

	/**
	 * @param now clock (injectable for tests)
	 * @param limit weekly limit of the App Key
	 */
	public constructor(
		private readonly now: () => number = Date.now,
		private readonly limit: number = WEEKLY_LIMIT,
	) {}

	/**
	 * Restores the counter from a stored list of time stamps (invalid entries are ignored).
	 *
	 * @param stored JSON text of a number array
	 */
	public load(stored: unknown): void {
		let list: unknown = [];
		if (typeof stored === 'string' && stored) {
			try {
				list = JSON.parse(stored);
			} catch {
				list = [];
			}
		}
		this.stamps = Array.isArray(list)
			? list.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
			: [];
		this.prune();
	}

	/** Time stamps as JSON text for storing */
	public serialize(): string {
		this.prune();
		return JSON.stringify(this.stamps);
	}

	/** Counts one request now. */
	public add(): void {
		this.stamps.push(this.now());
		this.prune();
	}

	/** Forgets all counted requests (e.g. after creating a new App Key). */
	public reset(): void {
		this.stamps = [];
	}

	/**
	 * Checks whether a number of further requests fits into the limit.
	 *
	 * @param count requests that are about to be sent
	 * @param reserve requests that must stay free for commands
	 */
	public allows(count: number, reserve = 0): boolean {
		return this.summary().remaining - reserve >= count;
	}

	/**
	 * Checks whether a request of the given priority may be sent now.
	 *
	 * @param priority importance of the request
	 * @returns true if the request fits into the limit (background requests keep the reserve free)
	 */
	public allowsPriority(priority: RequestPriority): boolean {
		const reserve = priority === 'background' ? Math.ceil((this.limit * COMMAND_RESERVE_PERCENT) / 100) : 0;
		return this.allows(1, reserve);
	}

	/** Current summary */
	public summary(): QuotaSummary {
		this.prune();
		const used = this.stamps.length;
		const remaining = Math.max(0, this.limit - used);
		const percent = Math.min(100, Math.round((used / this.limit) * 100));
		return {
			used,
			limit: this.limit,
			remaining,
			percent,
			warning: percent >= WARNING_PERCENT,
			nextRelease: used ? this.stamps[0] + WINDOW_MS : null,
		};
	}

	private prune(): void {
		const limit = this.now() - WINDOW_MS;
		let i = 0;
		while (i < this.stamps.length && this.stamps[i] <= limit) {
			i++;
		}
		if (i) {
			this.stamps.splice(0, i);
		}
	}
}
