/*
 * Minimal client for the GARDENA smart system cloud API v2 (Husqvarna Developer Portal).
 *
 * @KI_HINWEIS: Only the requests needed for reading device names are implemented. Every request to
 * api.smart.gardena.dev counts against the weekly limit (1000 per App Key, see Developer Portal); token requests go to the separate
 * Authentication API and are not counted. Tokens (client_credentials) are valid for 1 hour and have no
 * refresh token, so a token is reused until shortly before it expires.
 */

import type { QuotaCounter } from './quota';

/** Token endpoint of the Husqvarna Authentication API */
export const AUTH_URL = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token';
/** Base URL of the GARDENA smart system API v2 */
export const API_URL = 'https://api.smart.gardena.dev/v2';

/** Request timeout */
const TIMEOUT_MS = 20_000;

/** App Key / Secret rejected by the cloud */
export class CloudAuthError extends Error {}

/** Rate limit reached (HTTP 429) */
export class CloudQuotaError extends Error {
	/**
	 * @param message error text
	 * @param retryAfterMs waiting time requested by the cloud (ms), if given
	 */
	public constructor(
		message: string,
		public readonly retryAfterMs: number | null,
	) {
		super(message);
	}
}

/** Name and serial number of a device as known in the GARDENA app */
export interface CloudDevice {
	/** cloud device id */
	id: string;
	/** name given in the GARDENA app */
	name: string;
	/** serial number */
	serial: string;
	/** model, e.g. "GARDENA smart Water Control" */
	model: string;
	/** location (garden) the device belongs to */
	location: string;
}

/** Options of the cloud client */
export interface CloudClientOptions {
	/** Application Key from the Developer Portal */
	appKey: string;
	/** Application Secret from the Developer Portal */
	appSecret: string;
	/** request counter */
	quota: QuotaCounter;
	/** called after every counted request */
	onRequest?: () => void;
	/** fetch implementation (injectable for tests) */
	fetchFn?: typeof fetch;
	/** clock (injectable for tests) */
	now?: () => number;
}

/**
 * Reads data from the GARDENA smart system cloud.
 */
export class CloudClient {
	private token: string | undefined;
	private tokenValidUntil = 0;
	private readonly fetchFn: typeof fetch;
	private readonly now: () => number;

	/**
	 * @param options client options
	 */
	public constructor(private readonly options: CloudClientOptions) {
		this.fetchFn = options.fetchFn ?? fetch;
		this.now = options.now ?? Date.now;
	}

	/**
	 * Reads all devices of all locations: 1 request for the list of locations plus 1 per location.
	 *
	 * @returns devices with their names from the GARDENA app
	 */
	public async listDevices(): Promise<CloudDevice[]> {
		const locations = (await this.get('/locations')) as { data?: { id?: string }[] };
		const result: CloudDevice[] = [];
		for (const loc of locations.data ?? []) {
			if (!loc?.id) {
				continue;
			}
			const detail = (await this.get(`/locations/${encodeURIComponent(loc.id)}`)) as {
				data?: { attributes?: { name?: string } };
				included?: { id?: string; type?: string; attributes?: Record<string, { value?: unknown }> }[];
			};
			const locationName = detail.data?.attributes?.name ?? '';
			for (const item of detail.included ?? []) {
				if (item?.type !== 'COMMON' || !item.id) {
					continue;
				}
				const attr = item.attributes ?? {};
				const text = (key: string): string => {
					const value = attr[key]?.value;
					return typeof value === 'string' ? value.trim() : '';
				};
				result.push({
					id: item.id,
					name: text('name'),
					serial: text('serial'),
					model: text('modelType'),
					location: locationName,
				});
			}
		}
		return result;
	}

	/** Forgets the token (e.g. after changing the App Key). */
	public clearToken(): void {
		this.token = undefined;
		this.tokenValidUntil = 0;
	}

	private async get(path: string): Promise<unknown> {
		if (!this.options.quota.allows(1)) {
			throw new CloudQuotaError('Weekly limit of the GARDENA cloud reached (counted by the adapter)', null);
		}
		const token = await this.getToken();
		this.options.quota.add();
		this.options.onRequest?.();
		const res = await this.request(`${API_URL}${path}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				'X-Api-Key': this.options.appKey,
				'Authorization-Provider': 'husqvarna',
				Accept: 'application/vnd.api+json',
			},
		});
		if (res.status === 429) {
			throw new CloudQuotaError('The GARDENA cloud reports: too many requests', retryAfter(res));
		}
		if (res.status === 401) {
			// token no longer accepted: get a new one next time
			this.clearToken();
			throw new Error('The GARDENA cloud did not accept the access token (HTTP 401)');
		}
		if (res.status === 403) {
			throw new CloudAuthError(
				'Access denied (HTTP 403). Is the "GARDENA smart system API" connected to your application in the Developer Portal?',
			);
		}
		if (!res.ok) {
			throw new Error(`GARDENA cloud answered with HTTP ${res.status}`);
		}
		return res.json();
	}

	private async getToken(): Promise<string> {
		if (this.token && this.now() < this.tokenValidUntil) {
			return this.token;
		}
		const body = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: this.options.appKey,
			client_secret: this.options.appSecret,
		});
		const res = await this.request(AUTH_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
		if (res.status === 400 || res.status === 401 || res.status === 403) {
			throw new CloudAuthError('App Key or App Secret were not accepted. Please check them in the settings.');
		}
		if (res.status === 429) {
			throw new CloudQuotaError('The Husqvarna login reports: too many requests', retryAfter(res));
		}
		if (!res.ok) {
			throw new Error(`Husqvarna login answered with HTTP ${res.status}`);
		}
		const json = (await res.json()) as { access_token?: string; expires_in?: number };
		if (!json.access_token) {
			throw new Error('Husqvarna login returned no access token');
		}
		const lifetime = Math.max(60, Number(json.expires_in) || 3600);
		this.token = json.access_token;
		// renew 5 minutes before it expires
		this.tokenValidUntil = this.now() + (lifetime - 300) * 1000;
		return this.token;
	}

	private async request(url: string, init: RequestInit): Promise<Response> {
		try {
			return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
		} catch (err) {
			throw new Error(`GARDENA cloud not reachable: ${(err as Error).message}`);
		}
	}
}

/**
 * Reads the Retry-After header (seconds or HTTP date).
 *
 * @param res response
 * @returns waiting time in ms or null
 */
export function retryAfter(res: Response): number | null {
	const value = res.headers.get('retry-after');
	if (!value) {
		return null;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
