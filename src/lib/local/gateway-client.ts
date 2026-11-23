import { X509Certificate, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import * as tls from 'node:tls';
import WebSocket from 'ws';
import {
	type GatewayReply,
	type GatewayRequest,
	type GatewayService,
	type ValueField,
	isEvent,
	isReply,
	parseFrame,
} from './protocol';

/** Logger interface (ioBroker adapter log). */
export interface Logger {
	/** Logs a debug message */
	debug(msg: string): void;
	/** Logs an info message */
	info(msg: string): void;
	/** Logs a warning */
	warn(msg: string): void;
	/** Logs an error */
	error(msg: string): void;
}

/** Timer functions, injected so the adapter's own timers are used (cleared on unload). */
export interface Timers {
	/** Starts a timeout */
	startTimeout(cb: () => void, ms: number): unknown;
	/** Stops a timeout */
	stopTimeout(handle: unknown): void;
	/** Starts an interval */
	startInterval(cb: () => void, ms: number): unknown;
	/** Stops an interval */
	stopInterval(handle: unknown): void;
}

/** Options of the gateway client. */
export interface GatewayClientOptions {
	/** Host name or IP address of the gateway */
	host: string;
	/** Port of the local API (default 8443) */
	port: number;
	/** Password of the local API */
	password: string;
	/** Trusted certificate of the gateway (PEM). Without it the certificate is fetched and trusted on first use. */
	certificatePem?: string;
	/** Logger of the adapter */
	log: Logger;
	/** Timer functions of the adapter */
	timers: Timers;
}

/** Certificate details of the gateway. */
export interface GatewayCertificate {
	/** Certificate in PEM format */
	pem: string;
	/** SHA-256 fingerprint */
	fingerprint: string;
	/** mDNS name of the gateway (e.g. `GARDENA-123456`), if the certificate contains it */
	hostname?: string;
}

/** Error of a request (gateway answered with an error or `success: false`). */
export class RequestError extends Error {}

/** Thrown when the gateway presents another certificate than the trusted one. */
export class CertificateMismatchError extends Error {}

const REQUEST_TIMEOUT = 10_000;
const PING_INTERVAL = 30_000;
const RECONNECT_MIN = 5_000;
const RECONNECT_MAX = 60_000;
/** After a rejected password: retry only every 10 minutes to avoid locking the gateway. */
const RECONNECT_AUTH_FAILED = 600_000;

interface PendingRequest {
	resolve: (reply: GatewayReply) => void;
	reject: (err: Error) => void;
	timer: unknown;
}

/**
 * Converts a DER certificate to PEM.
 *
 * @param der raw certificate
 */
function derToPem(der: Buffer): string {
	const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
	return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Reads the certificate of the gateway without sending any credentials.
 *
 * @param host host name or IP of the gateway
 * @param port port of the local API
 */
export function fetchCertificate(host: string, port: number): Promise<GatewayCertificate> {
	return new Promise((resolve, reject) => {
		const socket = tls.connect({
			host,
			port,
			rejectUnauthorized: false,
			servername: isIP(host) ? undefined : host,
			timeout: 10_000,
		});
		socket.once('secureConnect', () => {
			const peer = socket.getPeerCertificate(false);
			socket.end();
			if (!peer?.raw) {
				reject(new Error('Gateway did not present a certificate'));
				return;
			}
			resolve(describeCertificate(derToPem(peer.raw)));
		});
		socket.once('timeout', () => {
			socket.destroy();
			reject(new Error(`Timeout while connecting to ${host}:${port}`));
		});
		socket.once('error', reject);
	});
}

/**
 * Returns fingerprint and mDNS name of a PEM certificate.
 *
 * @param pem certificate
 */
export function describeCertificate(pem: string): GatewayCertificate {
	const x509 = new X509Certificate(pem);
	const local = (x509.subjectAltName ?? '')
		.split(',')
		.map(s => s.trim())
		.find(s => s.startsWith('DNS:') && s.endsWith('.local'));
	return {
		pem,
		fingerprint: x509.fingerprint256,
		hostname: local ? local.slice(4, -'.local'.length) : undefined,
	};
}

/**
 * WebSocket client for the local API of the GARDENA smart Gateway.
 *
 * Events:
 * - `connected` – connection established and authenticated
 * - `disconnected` – connection lost (reconnect runs automatically)
 * - `event` (GatewayEvent) – value pushed by the gateway
 * - `certificate` (GatewayCertificate) – certificate trusted on first use, should be stored
 * - `authFailed` – password rejected
 * - `certificateMismatch` (GatewayCertificate) – gateway presents another certificate, client stops
 */
export class GatewayClient extends EventEmitter {
	private ws: WebSocket | null = null;
	private certificate: GatewayCertificate | undefined;
	private readonly pending = new Map<string, PendingRequest>();
	private reconnectTimer: unknown;
	private pingTimer: unknown;
	private reconnectDelay = RECONNECT_MIN;
	private alive = false;
	/** WebSocket handshake completed and not closed yet */
	private isOpen = false;
	private stopped = true;
	private outageLogged = false;

	/**
	 * @param options connection options
	 */
	public constructor(private readonly options: GatewayClientOptions) {
		super();
		if (options.certificatePem) {
			this.certificate = describeCertificate(options.certificatePem);
		}
	}

	/** True while the WebSocket is open. */
	public get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	/** Starts the connection; reconnects automatically until `stop()` is called. */
	public start(): void {
		this.stopped = false;
		void this.connect();
	}

	/** Closes the connection and stops reconnecting. Pending requests fail. */
	public stop(): void {
		this.stopped = true;
		this.options.timers.stopTimeout(this.reconnectTimer);
		this.closeSocket();
	}

	/**
	 * Sends requests and waits for all replies.
	 *
	 * @param requests requests without request id
	 * @param timeout timeout in ms
	 */
	public async request(
		requests: Omit<GatewayRequest, 'request_id'>[],
		timeout = REQUEST_TIMEOUT,
	): Promise<GatewayReply[]> {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			throw new Error('Not connected to the GARDENA smart Gateway');
		}
		const full: GatewayRequest[] = requests.map(r => ({ ...r, request_id: randomUUID() }));
		const promises = full.map(
			r =>
				new Promise<GatewayReply>((resolve, reject) => {
					const timer = this.options.timers.startTimeout(() => {
						this.pending.delete(r.request_id);
						reject(new Error(`Gateway did not answer within ${timeout / 1000} s`));
					}, timeout);
					this.pending.set(r.request_id, { resolve, reject, timer });
				}),
		);
		ws.send(JSON.stringify(full));
		const replies = await Promise.all(promises);
		const failed = replies.find(r => !r.success);
		if (failed) {
			const reason =
				(failed.payload as ValueField | undefined)?.vs ?? failed.metadata?.error_source ?? 'unknown reason';
			throw new RequestError(`Gateway rejected the request: ${reason}`);
		}
		return replies;
	}

	/**
	 * Writes a value.
	 *
	 * @param service gateway service of the device
	 * @param device device id
	 * @param path resource path, e.g. `lemonbeat/0/watering_timer_1`
	 * @param payload value field
	 */
	public async write(service: GatewayService, device: string, path: string, payload: ValueField): Promise<void> {
		await this.request([{ op: 'write', entity: { service, device, path }, payload }]);
	}

	/**
	 * Executes a resource (Gen2 commands like `actuator/0/start`).
	 *
	 * @param service gateway service of the device
	 * @param device device id
	 * @param path resource path
	 * @param payload optional arguments
	 */
	public async execute(service: GatewayService, device: string, path: string, payload?: ValueField): Promise<void> {
		await this.request([{ op: 'execute', entity: { service, device, path }, ...(payload ? { payload } : {}) }]);
	}

	/**
	 * Reads all devices of both services (Gen1 and Gen2).
	 * A service that fails (e.g. not available on old firmware) is skipped.
	 *
	 * @returns map of device id -> { service, tree }
	 */
	public async discover(): Promise<Map<string, { service: GatewayService; tree: Record<string, unknown> }>> {
		const result = new Map<string, { service: GatewayService; tree: Record<string, unknown> }>();
		for (const service of ['lemonbeatd', 'lwm2mserver'] as GatewayService[]) {
			try {
				const [reply] = await this.request([{ op: 'read', entity: { service, path: 'devices' } }], 30_000);
				for (const [id, tree] of Object.entries(reply.payload ?? {})) {
					if (tree && typeof tree === 'object') {
						result.set(id, { service, tree: tree as Record<string, unknown> });
					}
				}
			} catch (err) {
				this.options.log.debug(`Discovery of ${service} failed: ${(err as Error).message}`);
			}
		}
		return result;
	}

	private async connect(): Promise<void> {
		if (this.stopped) {
			return;
		}
		const { host, port, log } = this.options;
		try {
			if (!this.certificate) {
				// @KI_HINWEIS: Trust on first use – the certificate is fetched without credentials,
				// stored by the adapter and pinned for all later connections.
				const cert = await fetchCertificate(host, port);
				this.certificate = cert;
				log.info(`Trusting certificate of the gateway ${cert.hostname ?? host} (SHA-256 ${cert.fingerprint})`);
				this.emit('certificate', cert);
			}
		} catch (err) {
			this.handleConnectError(err as Error);
			return;
		}

		const trusted = this.certificate;
		const auth = Buffer.from(`_:${this.options.password}`).toString('base64');
		// @KI_HINWEIS: The pinned certificate is the only trusted CA. checkServerIdentity skips the
		// host name check (the gateway is usually addressed by IP) and compares the fingerprint instead.
		// So the password is only sent after the TLS handshake proved that it is our gateway.
		const tlsOptions: tls.ConnectionOptions = {
			ca: [trusted.pem],
			servername: isIP(host) ? undefined : host,
			checkServerIdentity: (_host: string, cert: tls.PeerCertificate) =>
				cert.fingerprint256 === trusted.fingerprint
					? undefined
					: new CertificateMismatchError('Certificate mismatch'),
		};
		// @KI_HINWEIS: ws passes these options unchanged to tls.connect(); its typings declare
		// checkServerIdentity differently, therefore the cast.
		const ws = new WebSocket(`wss://${host}:${port}`, {
			...(tlsOptions as unknown as WebSocket.ClientOptions),
			headers: { Authorization: `Basic ${auth}` },
			handshakeTimeout: 15_000,
		});
		this.ws = ws;

		ws.on('open', () => {
			this.reconnectDelay = RECONNECT_MIN;
			this.alive = true;
			this.isOpen = true;
			if (this.outageLogged) {
				log.info(`Reconnected to the GARDENA smart Gateway at ${host}`);
				this.outageLogged = false;
			} else {
				log.info(`Connected to the GARDENA smart Gateway at ${host}`);
			}
			this.startPing(ws);
			this.emit('connected');
		});
		ws.on('message', (data: Buffer) => this.onMessage(data.toString('utf8')));
		ws.on('pong', () => {
			this.alive = true;
		});
		ws.on('unexpected-response', (_req, res) => {
			if (res.statusCode === 401) {
				log.error(
					'The GARDENA smart Gateway rejected the password. Please check the password in the adapter settings.',
				);
				this.emit('authFailed');
				this.reconnectDelay = RECONNECT_AUTH_FAILED;
			} else {
				log.warn(
					`Gateway answered with HTTP ${res.statusCode}. Is the "local API" enabled in the gateway settings?`,
				);
			}
			ws.terminate();
		});
		ws.on('error', err => this.handleConnectError(err));
		ws.on('close', () => {
			// @KI_HINWEIS: not "alive" – after a ping timeout alive is already false, but the
			// connection was open and "disconnected" must still be reported.
			const wasOpen = this.isOpen;
			this.isOpen = false;
			this.stopPing();
			if (this.ws === ws) {
				this.ws = null;
			}
			this.failPending(new Error('Connection to the gateway closed'));
			if (wasOpen) {
				this.alive = false;
				this.emit('disconnected');
			}
			this.scheduleReconnect();
		});
	}

	private handleConnectError(err: Error): void {
		const { log, host } = this.options;
		const mismatch =
			err instanceof CertificateMismatchError ||
			/certificate|self.signed|CERT_/i.test(`${err.message} ${(err as NodeJS.ErrnoException).code ?? ''}`);
		if (mismatch && this.certificate) {
			log.error(
				`The gateway at ${host} presents another certificate than the trusted one (gateway reset or replaced?). ` +
					'Connection stopped for security reasons. Press "Trust new gateway certificate" (info.trustNewCertificate) to accept it.',
			);
			this.emit('certificateMismatch', this.certificate);
			this.stopped = true;
			this.closeSocket();
			return;
		}
		if (!this.outageLogged) {
			log.warn(`Connection to the GARDENA smart Gateway at ${host} failed: ${err.message}`);
			this.outageLogged = true;
		} else {
			log.debug(`Reconnect failed: ${err.message}`);
		}
		if (!this.ws) {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped) {
			return;
		}
		this.options.timers.stopTimeout(this.reconnectTimer);
		const delay = this.reconnectDelay;
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, Math.max(RECONNECT_MAX, delay));
		this.reconnectTimer = this.options.timers.startTimeout(() => void this.connect(), delay);
	}

	private startPing(ws: WebSocket): void {
		this.stopPing();
		this.pingTimer = this.options.timers.startInterval(() => {
			if (!this.alive) {
				this.options.log.warn('Gateway does not answer anymore, reconnecting');
				this.outageLogged = true;
				ws.terminate();
				return;
			}
			this.alive = false;
			ws.ping();
		}, PING_INTERVAL);
	}

	private stopPing(): void {
		this.options.timers.stopInterval(this.pingTimer);
		this.pingTimer = undefined;
	}

	private closeSocket(): void {
		this.stopPing();
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			ws.removeAllListeners();
			ws.on('error', () => undefined);
			ws.terminate();
		}
		this.failPending(new Error('Connection closed'));
	}

	private failPending(err: Error): void {
		for (const [id, p] of this.pending) {
			this.options.timers.stopTimeout(p.timer);
			p.reject(err);
			this.pending.delete(id);
		}
	}

	private onMessage(raw: string): void {
		for (const msg of parseFrame(raw)) {
			if (isReply(msg)) {
				const p = this.pending.get(msg.request_id);
				if (p) {
					this.options.timers.stopTimeout(p.timer);
					this.pending.delete(msg.request_id);
					p.resolve(msg);
				}
				continue;
			}
			if (isEvent(msg)) {
				this.emit('event', msg);
			}
		}
	}
}
