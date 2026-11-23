import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { type GatewayCertificate, GatewayClient, type Timers } from './gateway-client';

const fixtures = join(__dirname, '..', '..', '..', 'test', 'fixtures');
const certA = {
	key: readFileSync(join(fixtures, 'gateway-a.key')),
	cert: readFileSync(join(fixtures, 'gateway-a.crt')),
};
const certB = {
	key: readFileSync(join(fixtures, 'gateway-b.key')),
	cert: readFileSync(join(fixtures, 'gateway-b.crt')),
};
const PASSWORD = 'secret';

const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
const timers: Timers = {
	setTimeout: (cb, ms) => setTimeout(cb, ms),
	clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
	setInterval: (cb, ms) => setInterval(cb, ms),
	clearInterval: h => clearInterval(h as NodeJS.Timeout),
};

interface MockGateway {
	port: number;
	received: any[];
	authHeaders: string[];
	close(): Promise<void>;
}

/**
 * Minimal mock of the gateway: answers discovery and writes, pushes an event after a write.
 *
 * @param tlsCert key and certificate
 * @param tlsCert.key private key of the mock gateway
 * @param tlsCert.cert certificate of the mock gateway
 */
function startMock(tlsCert: { key: Buffer; cert: Buffer }): Promise<MockGateway> {
	return new Promise(resolve => {
		const received: any[] = [];
		const authHeaders: string[] = [];
		const server: Server = createServer(tlsCert);
		const wss = new WebSocketServer({
			server,
			verifyClient: (info, cb) => {
				const auth = info.req.headers.authorization ?? '';
				authHeaders.push(auth);
				const ok = auth === `Basic ${Buffer.from(`_:${PASSWORD}`).toString('base64')}`;
				cb(ok, ok ? undefined : 401);
			},
		});
		wss.on('connection', ws => {
			ws.on('message', (raw: Buffer) => {
				const msgs = JSON.parse(raw.toString('utf8'));
				const replies: any[] = [];
				for (const m of msgs) {
					received.push(m);
					if (m.op === 'read' && m.entity.path === 'devices') {
						replies.push({
							entity: m.entity,
							request_id: m.request_id,
							success: true,
							payload:
								m.entity.service === 'lemonbeatd'
									? {
											DEV1: {
												device: { 0: { model_number: { vs: '18869' } } },
												lemonbeat: { 0: { watering_timer_1: { vi: 0 } } },
											},
										}
									: {},
						});
					} else {
						replies.push({ entity: m.entity, request_id: m.request_id, success: m.entity.path !== 'fail' });
					}
				}
				ws.send(JSON.stringify(replies));
				const write = msgs.find((m: any) => m.op === 'write');
				if (write) {
					ws.send(
						JSON.stringify([
							{
								entity: { device: write.entity.device, path: 'lemonbeat/0' },
								op: 'update',
								payload: { watering_timer_1: write.payload },
							},
						]),
					);
				}
			});
		});
		server.listen(0, '127.0.0.1', () => {
			resolve({
				port: (server.address() as AddressInfo).port,
				received,
				authHeaders,
				close: () =>
					new Promise<void>(r => {
						for (const c of wss.clients) {
							c.terminate();
						}
						wss.close();
						server.close(() => r());
					}),
			});
		});
	});
}

function waitFor<T>(client: GatewayClient, event: string): Promise<T> {
	return new Promise(resolve => client.once(event, (arg: T) => resolve(arg)));
}

describe('GatewayClient', function () {
	this.timeout(10_000);
	let mock: MockGateway;
	let client: GatewayClient | undefined;

	afterEach(async () => {
		client?.stop();
		client = undefined;
		await mock?.close();
	});

	it('trusts the certificate on first use, connects, discovers and writes', async () => {
		mock = await startMock(certA);
		client = new GatewayClient({ host: '127.0.0.1', port: mock.port, password: PASSWORD, log: silent, timers });
		const certPromise = waitFor<GatewayCertificate>(client, 'certificate');
		const connected = waitFor(client, 'connected');
		client.start();
		const cert = await certPromise;
		expect(cert.hostname).to.equal('GARDENA-12345a');
		await connected;

		const devices = await client.discover();
		expect([...devices.keys()]).to.deep.equal(['DEV1']);
		expect(devices.get('DEV1')?.service).to.equal('lemonbeatd');

		const event = waitFor<any>(client, 'event');
		await client.write('lemonbeatd', 'DEV1', 'lemonbeat/0/watering_timer_1', { vi: 600 });
		const ev = await event;
		expect(ev.entity.device).to.equal('DEV1');
		expect(ev.payload.watering_timer_1).to.deep.equal({ vi: 600 });
		expect(mock.received.find(m => m.op === 'write').payload).to.deep.equal({ vi: 600 });
	});

	it('rejects a failed request', async () => {
		mock = await startMock(certA);
		client = new GatewayClient({ host: '127.0.0.1', port: mock.port, password: PASSWORD, log: silent, timers });
		const connected = waitFor(client, 'connected');
		client.start();
		await connected;
		let error: Error | undefined;
		try {
			await client.execute('lwm2mserver', 'DEV1', 'fail');
		} catch (err) {
			error = err as Error;
		}
		expect(error?.message).to.match(/rejected/);
	});

	it('reports a wrong password', async () => {
		mock = await startMock(certA);
		client = new GatewayClient({ host: '127.0.0.1', port: mock.port, password: 'wrong', log: silent, timers });
		const failed = waitFor(client, 'authFailed');
		client.start();
		await failed;
		expect(client.connected).to.equal(false);
	});

	it('does not send the password to a gateway with another certificate', async () => {
		mock = await startMock(certB);
		const pinnedA = certA.cert.toString();
		client = new GatewayClient({
			host: '127.0.0.1',
			port: mock.port,
			password: PASSWORD,
			certificatePem: pinnedA,
			log: silent,
			timers,
		});
		const mismatch = waitFor(client, 'certificateMismatch');
		client.start();
		await mismatch;
		expect(mock.authHeaders).to.deep.equal([]);
		expect(client.connected).to.equal(false);
	});
});
