/*
 * ioBroker adapter for the GARDENA smart system
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';
import { CloudAuthError, CloudClient, CloudQuotaError } from './lib/cloud/cloud-client';
import { QuotaCounter, WEEKLY_LIMIT } from './lib/cloud/quota';
import { DeviceManager } from './lib/devices/device-manager';
import { type GatewayCertificate, GatewayClient, type Timers } from './lib/local/gateway-client';
import type { GatewayEvent } from './lib/local/protocol';

/** States the user can write (subscribed, all others are only written by the adapter). */
const COMMAND_PATTERNS = [
	'devices.*.open',
	'devices.*.duration',
	'devices.*.buttonTime',
	'devices.*.identify',
	'devices.*.closeAll',
	'devices.*.measure',
	'devices.*.on',
	'devices.*.start',
	'devices.*.parkUntilNextTask',
	'devices.*.parkUntilFurtherNotice',
	'devices.*.pause',
	'devices.*.operatingMode',
	'info.trustNewCertificate',
	'cloud.refresh',
	'cloud.quota.reset',
];

/** Device names are read from the cloud once a day (2 requests per garden). */
const CLOUD_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Waiting time after a "too many requests" answer without Retry-After */
const CLOUD_BLOCK_DEFAULT_MS = 60 * 60 * 1000;

class GardenaSmart extends utils.Adapter {
	private client: GatewayClient | undefined;
	private devices: DeviceManager | undefined;
	private rediscoverTimer: ioBroker.Timeout | undefined;
	private discovering = false;
	private cloud: CloudClient | undefined;
	private quota = new QuotaCounter();
	private cloudNames: Map<string, string> | undefined;
	private cloudTimer: ioBroker.Interval | undefined;
	private quotaTimer: ioBroker.Interval | undefined;
	private cloudBlockedUntil = 0;
	private cloudStarted = false;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'gardena-smart',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		await this.setState('info.connection', false, true);

		const host = (this.config.host ?? '').trim();
		const port = Number(this.config.port) || 8443;
		if (!host || !this.config.password) {
			this.log.error(
				'Please enter the address and the password of your GARDENA smart Gateway in the adapter settings.',
			);
			return;
		}

		for (const pattern of COMMAND_PATTERNS) {
			this.subscribeStates(pattern);
		}
		await this.initCloud();
		this.startClient(host, port);
	}

	/**
	 * Creates the gateway connection. A stored certificate is pinned, otherwise it is trusted on first use.
	 *
	 * @param host address of the gateway
	 * @param port port of the local API
	 */
	private startClient(host: string, port: number): void {
		void (async () => {
			const stored = await this.getStateAsync('info.certificate');
			const certificatePem =
				typeof stored?.val === 'string' && stored.val.includes('BEGIN CERTIFICATE') ? stored.val : undefined;

			const timers: Timers = {
				setTimeout: (cb, ms) => this.setTimeout(cb, ms),
				clearTimeout: h => this.clearTimeout(h as ioBroker.Timeout),
				setInterval: (cb, ms) => this.setInterval(cb, ms),
				clearInterval: h => this.clearInterval(h as ioBroker.Interval),
			};
			const client = new GatewayClient({
				host,
				port,
				password: this.config.password,
				certificatePem,
				log: this.log,
				timers,
			});
			this.client = client;
			this.devices = new DeviceManager(this, client, !!this.config.rawStates);

			client.on('certificate', (cert: GatewayCertificate) => void this.storeCertificate(cert));
			client.on('connected', () => void this.onConnected());
			client.on('disconnected', () => void this.setState('info.connection', false, true));
			client.on('authFailed', () => void this.setState('info.connection', false, true));
			client.on('certificateMismatch', () => void this.setState('info.connection', false, true));
			client.on('event', (event: GatewayEvent) => void this.onGatewayEvent(event));
			if (certificatePem) {
				const fp = await this.getStateAsync('info.certificateFingerprint');
				this.log.debug(`Using pinned gateway certificate ${String(fp?.val ?? '')}`);
			}
			client.start();
		})();
	}

	private async storeCertificate(cert: GatewayCertificate): Promise<void> {
		await this.setState('info.certificate', cert.pem, true);
		await this.setState('info.certificateFingerprint', cert.fingerprint, true);
		if (cert.hostname) {
			await this.setState('info.gateway', cert.hostname, true);
		}
	}

	private async onConnected(): Promise<void> {
		await this.setState('info.connection', true, true);
		await this.discover();
	}

	/** Reads all devices from the gateway and updates the objects. */
	private async discover(): Promise<void> {
		if (!this.client || !this.devices || this.discovering) {
			return;
		}
		this.discovering = true;
		try {
			const found = await this.client.discover();
			await this.devices.sync(found);
			await this.setState('info.devices', this.devices.count, true);
			this.log.info(`${found.size} GARDENA device(s) found`);
			if (this.cloudNames) {
				await this.devices.applyNames(this.cloudNames);
			} else if (this.cloud && !this.cloudStarted) {
				this.cloudStarted = true;
				void this.refreshCloud();
			}
		} catch (err) {
			this.log.warn(`Reading the devices failed: ${(err as Error).message}`);
		} finally {
			this.discovering = false;
		}
	}

	private async onGatewayEvent(event: GatewayEvent): Promise<void> {
		if (!this.devices) {
			return;
		}
		try {
			const known = await this.devices.applyEvent(event);
			if (!known && !this.rediscoverTimer) {
				// a new device was added to the gateway: read the device list again (debounced)
				this.rediscoverTimer = this.setTimeout(() => {
					this.rediscoverTimer = undefined;
					void this.discover();
				}, 5_000);
			}
		} catch (err) {
			this.log.warn(`Processing a gateway message failed: ${(err as Error).message}`);
		}
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}
		if (id === `${this.namespace}.info.trustNewCertificate`) {
			this.log.info('Trusting the next certificate the gateway presents');
			this.client?.stop();
			await this.setState('info.certificate', '', true);
			await this.setState('info.certificateFingerprint', '', true);
			this.startClient((this.config.host ?? '').trim(), Number(this.config.port) || 8443);
			return;
		}
		if (id === `${this.namespace}.cloud.refresh`) {
			await this.refreshCloud();
			return;
		}
		if (id === `${this.namespace}.cloud.quota.reset`) {
			this.log.info('Request counter of the GARDENA cloud reset');
			this.quota.reset();
			this.cloudBlockedUntil = 0;
			await this.saveQuota();
			return;
		}
		if (!this.client?.connected) {
			this.log.warn('Command not possible: no connection to the GARDENA smart Gateway');
			return;
		}
		await this.devices?.handleCommand(id, state);
	}

	/** Prepares the optional cloud connection (only if App Key and App Secret are entered). */
	private async initCloud(): Promise<void> {
		const appKey = (this.config.appKey ?? '').trim();
		const appSecret = (this.config.appSecret ?? '').trim();
		await this.setState('cloud.connection', false, true);
		const limit = Math.round(Number(this.config.cloudLimit));
		this.quota = new QuotaCounter(Date.now, limit > 0 ? limit : WEEKLY_LIMIT);
		const stored = await this.getStateAsync('cloud.quota.log');
		this.quota.load(stored?.val);
		await this.updateQuotaStates();
		// the rolling window moves on even without requests
		this.quotaTimer = this.setInterval(() => void this.updateQuotaStates(), 60 * 60 * 1000);
		if (!appKey || !appSecret) {
			this.log.debug('No App Key entered: the GARDENA cloud is not used');
			return;
		}
		this.cloud = new CloudClient({
			appKey,
			appSecret,
			quota: this.quota,
			onRequest: () => void this.saveQuota(),
		});
		this.cloudTimer = this.setInterval(() => void this.refreshCloud(), CLOUD_REFRESH_MS);
	}

	/** Reads the device names from the GARDENA app (cloud) and takes them over. */
	private async refreshCloud(): Promise<void> {
		if (!this.cloud) {
			this.log.warn('Please enter App Key and App Secret in the settings to use the GARDENA cloud');
			return;
		}
		if (Date.now() < this.cloudBlockedUntil) {
			this.log.info(
				`GARDENA cloud paused until ${new Date(this.cloudBlockedUntil).toLocaleString()} (too many requests)`,
			);
			return;
		}
		try {
			const list = await this.cloud.listDevices();
			const names = new Map<string, string>();
			for (const dev of list) {
				if (dev.serial && dev.name) {
					names.set(dev.serial, dev.name);
				}
			}
			this.cloudNames = names;
			const renamed = this.devices ? await this.devices.applyNames(names) : 0;
			await this.setState('cloud.connection', true, true);
			await this.setState('cloud.lastUpdate', Date.now(), true);
			await this.setState('cloud.blocked', false, true);
			this.log.info(`GARDENA cloud: ${list.length} device(s) in the app, ${renamed} name(s) taken over`);
		} catch (err) {
			await this.setState('cloud.connection', false, true);
			if (err instanceof CloudAuthError) {
				this.log.error(`GARDENA cloud: ${err.message}`);
			} else if (err instanceof CloudQuotaError) {
				const summary = this.quota.summary();
				const wait =
					err.retryAfterMs ??
					(summary.remaining === 0 && summary.nextRelease
						? summary.nextRelease - Date.now()
						: CLOUD_BLOCK_DEFAULT_MS);
				this.cloudBlockedUntil = Date.now() + Math.max(wait, 60_000);
				await this.setState('cloud.blocked', true, true);
				await this.setState('cloud.blockedUntil', this.cloudBlockedUntil, true);
				this.log.warn(
					`GARDENA cloud: ${err.message}. Next try after ${new Date(this.cloudBlockedUntil).toLocaleString()}`,
				);
			} else {
				this.log.warn(`GARDENA cloud: ${(err as Error).message}`);
			}
		}
	}

	private async saveQuota(): Promise<void> {
		await this.setState('cloud.quota.log', this.quota.serialize(), true);
		await this.updateQuotaStates();
	}

	private async updateQuotaStates(): Promise<void> {
		const q = this.quota.summary();
		await this.setStateChangedAsync('cloud.quota.used', q.used, true);
		await this.setStateChangedAsync('cloud.quota.limit', q.limit, true);
		await this.setStateChangedAsync('cloud.quota.remaining', q.remaining, true);
		await this.setStateChangedAsync('cloud.quota.percent', q.percent, true);
		await this.setStateChangedAsync('cloud.quota.warning', q.warning, true);
		if (this.cloudBlockedUntil && Date.now() >= this.cloudBlockedUntil) {
			this.cloudBlockedUntil = 0;
			await this.setStateChangedAsync('cloud.blocked', false, true);
		}
	}

	private onUnload(callback: () => void): void {
		try {
			this.client?.stop();
			if (this.cloudTimer) {
				this.clearInterval(this.cloudTimer);
			}
			if (this.quotaTimer) {
				this.clearInterval(this.quotaTimer);
			}
			void this.setState('info.connection', false, true);
			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new GardenaSmart(options);
} else {
	// otherwise start the instance directly
	(() => new GardenaSmart())();
}
