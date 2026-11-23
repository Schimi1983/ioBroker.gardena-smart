/* eslint-disable @typescript-eslint/require-await -- fakes implement async interfaces */
import { expect } from 'chai';
import type { GatewayClient } from '../local/gateway-client';
import { DeviceManager, serialFromDeviceId } from './device-manager';

interface Call {
	op: 'write' | 'execute';
	device: string;
	path: string;
	payload?: unknown;
}

/** Minimal in-memory adapter for the DeviceManager */
function fakeAdapter(): { adapter: ioBroker.Adapter; states: Map<string, ioBroker.State>; logs: string[] } {
	const states = new Map<string, ioBroker.State>();
	const objects = new Map<string, any>();
	const logs: string[] = [];
	const ns = 'gardena-smart.0';
	const full = (id: string): string => (id.startsWith(ns) ? id : `${ns}.${id}`);
	const adapter = {
		namespace: ns,
		log: {
			debug: () => undefined,
			info: (m: string) => logs.push(m),
			warn: (m: string) => logs.push(m),
			error: (m: string) => logs.push(m),
		},
		extendObject: async (id: string, obj: any) => {
			objects.set(full(id), {
				...(objects.get(full(id)) ?? {}),
				...obj,
				common: { ...(objects.get(full(id))?.common ?? {}), ...obj.common },
			});
		},
		getObjectAsync: async (id: string) => objects.get(full(id)) ?? null,
		getObjectViewAsync: async (_d: string, _s: string, p: { startkey: string; endkey: string }) => ({
			rows: [...objects.entries()]
				.filter(([k, o]) => o.type === 'state' && k >= p.startkey && k <= p.endkey)
				.map(([id]) => ({ id })),
		}),
		delObjectAsync: async (id: string) => {
			objects.delete(full(id));
		},
		setObjectNotExistsAsync: async () => undefined,
		getStateAsync: async (id: string) => states.get(full(id)) ?? null,
		setState: async (id: string, val: any, ack?: boolean) => {
			const st = val && typeof val === 'object' && 'val' in val ? val : { val, ack };
			states.set(full(id), st);
		},
		setStateChangedAsync: async (id: string, val: any, ack?: boolean) => {
			const st = val && typeof val === 'object' && 'val' in val ? val : { val, ack };
			states.set(full(id), st);
		},
	} as unknown as ioBroker.Adapter;
	return { adapter, states, logs };
}

function fakeClient(calls: Call[]): GatewayClient {
	return {
		write: async (_s: string, device: string, path: string, payload: unknown) => {
			calls.push({ op: 'write', device, path, payload });
		},
		execute: async (_s: string, device: string, path: string, payload?: unknown) => {
			calls.push({ op: 'execute', device, path, payload });
		},
	} as unknown as GatewayClient;
}

const online = { connection_status: { 0: { online: { vb: true } } } };
const cmd = (val: ioBroker.StateValue): ioBroker.State => ({ val, ack: false }) as ioBroker.State;

describe('DeviceManager commands', () => {
	async function setup(
		devices: Record<string, { service: 'lemonbeatd' | 'lwm2mserver'; tree: Record<string, unknown> }>,
	): Promise<{
		dm: DeviceManager;
		calls: Call[];
		states: Map<string, ioBroker.State>;
		logs: string[];
	}> {
		const calls: Call[] = [];
		const { adapter, states, logs } = fakeAdapter();
		const dm = new DeviceManager(adapter, fakeClient(calls), false);
		await dm.sync(new Map(Object.entries(devices)));
		return { dm, calls, states, logs };
	}

	it('opens a Gen1 valve for the configured duration and closes all valves', async () => {
		const { dm, calls } = await setup({
			IC1: { service: 'lemonbeatd', tree: { ...online, device: { 0: { model_number: { vs: '31653' } } } } },
		});
		await dm.handleCommand('gardena-smart.0.devices.IC1.valve3.duration', cmd(12));
		await dm.handleCommand('gardena-smart.0.devices.IC1.valve3.open', cmd(true));
		await dm.handleCommand('gardena-smart.0.devices.IC1.closeAll', cmd(true));
		expect(calls).to.deep.equal([
			{ op: 'write', device: 'IC1', path: 'lemonbeat/0/watering_timer_3', payload: { vi: 720 } },
			{ op: 'write', device: 'IC1', path: 'lemonbeat/0/command', payload: { vi: 22 } },
		]);
	});

	it('starts and stops a Gen2 valve with the WebSocket command source', async () => {
		const { dm, calls } = await setup({
			WC2: {
				service: 'lwm2mserver',
				tree: {
					...online,
					device: { 0: { model_number: { vs: '2812' } } },
					actuator: { 0: { state: { vi: 0 } } },
				},
			},
		});
		await dm.handleCommand('gardena-smart.0.devices.WC2.valve1.open', cmd(true));
		await dm.handleCommand('gardena-smart.0.devices.WC2.valve1.open', cmd(false));
		expect(calls[0]).to.deep.equal({
			op: 'execute',
			device: 'WC2',
			path: 'actuator/0/start',
			payload: { as: ["0='18',1='1800'"] },
		});
		expect(calls[1]).to.deep.equal({
			op: 'execute',
			device: 'WC2',
			path: 'actuator/0/stop',
			payload: { as: ["0='18'"] },
		});
	});

	it('does not send commands to offline devices', async () => {
		const { dm, calls, logs } = await setup({
			WC1: {
				service: 'lemonbeatd',
				tree: {
					connection_status: { 0: { online: { vb: false } } },
					device: { 0: { model_number: { vs: '18869' } } },
				},
			},
		});
		await dm.handleCommand('gardena-smart.0.devices.WC1.valve1.open', cmd(true));
		expect(calls).to.deep.equal([]);
		expect(logs.some(l => l.includes('offline'))).to.equal(true);
	});

	it('starts a LONA mower and parks a Gen1 mower until further notice', async () => {
		const { dm, calls } = await setup({
			M1: {
				service: 'lemonbeatd',
				tree: {
					...online,
					device: { 0: { model_number: { vs: '53988' } } },
					lemonbeat: { 0: { status: { vi: 7 } } },
				},
			},
		});
		await dm.handleCommand('gardena-smart.0.devices.M1.mower.duration', cmd(2));
		await dm.handleCommand('gardena-smart.0.devices.M1.mower.start', cmd(true));
		await dm.handleCommand('gardena-smart.0.devices.M1.mower.parkUntilFurtherNotice', cmd(true));
		expect(calls[0].path).to.equal('lemonbeat/0/mower_timer_with_distance');
		expect(Buffer.from((calls[0].payload as any).vo, 'base64')).to.deep.equal(Buffer.from([0, 0, 0, 0, 0, 120]));
		expect(Buffer.from((calls[1].payload as any).vo, 'base64')).to.deep.equal(
			Buffer.from([0xfa, 0x07, 12, 31, 22, 0]),
		);
	});
});

describe('DeviceManager names from the cloud', () => {
	it('takes over the app name only while the automatic name is unchanged', async () => {
		const { adapter } = fakeAdapter();
		const dm = new DeviceManager(adapter, fakeClient([]), false);
		const tree = (serial: string): Record<string, unknown> => ({
			device: {
				0: {
					device_type: { vs: 'Water Control' },
					serial_number: { vs: serial },
					model_number: { vs: '18869' },
				},
			},
		});
		await dm.sync(
			new Map([
				['A', { service: 'lemonbeatd' as const, tree: tree('111') }],
				['B', { service: 'lemonbeatd' as const, tree: tree('222') }],
			]),
		);
		await adapter.extendObject('devices.A', { common: { name: 'Water Control 111' } });
		await adapter.extendObject('devices.B', { common: { name: 'Mein Name' } });
		const names = new Map([
			['111', 'Vorgarten'],
			['222', 'Terrasse'],
		]);
		expect(await dm.applyNames(names)).to.equal(1);
		expect((await adapter.getObjectAsync('devices.A'))?.common.name).to.equal('Vorgarten');
		expect((await adapter.getObjectAsync('devices.B'))?.common.name).to.equal('Mein Name');
		expect(await dm.applyNames(names)).to.equal(0);
	});
});

describe('serialFromDeviceId', () => {
	it('decodes the serial number from the SGTIN-96 device id', () => {
		expect(serialFromDeviceId('3034F8EE90126D400003C557')).to.equal('00247127');
		expect(serialFromDeviceId('3034F8EE9012980000057BA5')).to.equal('00359333');
		expect(serialFromDeviceId('not-an-epc')).to.equal(null);
	});
});

describe('DeviceManager cleanup', () => {
	it('removes states the adapter no longer creates', async () => {
		const { adapter } = fakeAdapter();
		const dm = new DeviceManager(adapter, fakeClient([]), false);
		await adapter.extendObject('devices.A.valve1.pauseSchedule', { type: 'state', common: { name: 'old' } });
		await dm.sync(
			new Map([
				[
					'A',
					{
						service: 'lemonbeatd' as const,
						tree: {
							device: { 0: { device_type: { vs: 'Water Control' }, model_number: { vs: '18869' } } },
						},
					},
				],
			]),
		);
		expect(await adapter.getObjectAsync('devices.A.valve1.pauseSchedule')).to.equal(null);
	});
});
