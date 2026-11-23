/*
 * ioBroker adapter for the GARDENA smart system
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';
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
	'info.trustNewCertificate',
];

class GardenaSmart extends utils.Adapter {
	private client: GatewayClient | undefined;
	private devices: DeviceManager | undefined;
	private rediscoverTimer: ioBroker.Timeout | undefined;
	private discovering = false;

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
		if (!this.client?.connected) {
			this.log.warn('Command not possible: no connection to the GARDENA smart Gateway');
			return;
		}
		await this.devices?.handleCommand(id, state);
	}

	private onUnload(callback: () => void): void {
		try {
			this.client?.stop();
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
