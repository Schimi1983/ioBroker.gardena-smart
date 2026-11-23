import { expect } from 'chai';
import { type DeviceSnapshot, buildDevice, buildRawStates, deviceName } from './states';

const f = (v: Record<string, unknown>): Record<string, unknown> => ({ ...v, ts: 1700000000 });

function waterControl1(timer: number): DeviceSnapshot {
	return {
		id: 'WC1',
		kind: 'waterControl1',
		service: 'lemonbeatd',
		tree: {
			connection_status: { 0: { online: f({ vb: true }) } },
			device: {
				0: {
					device_type: f({ vs: 'Water Control' }),
					serial_number: f({ vs: '00012345' }),
					model_number: f({ vs: '18869' }),
					software_version: f({ vs: '2.5.0' }),
				},
			},
			lemonbeat: {
				0: {
					battery_level: f({ vi: 86 }),
					ambient_temperature: f({ vi: 18 }),
					frost_warning: f({ vi: 0 }),
					rf_link_quality: f({ vi: 100 }),
					button_config_time: f({ vi: 1800 }),
					valve_error_1: f({ vi: 0 }),
					watering_timer_1: f({ vi: timer }),
				},
			},
		},
	};
}

describe('device states', () => {
	it('builds a Gen1 Water Control', () => {
		const dev = waterControl1(0);
		expect(deviceName(dev)).to.equal('Water Control 00012345');
		const { channels, states } = buildDevice(dev);
		const byId = Object.fromEntries(states.map(s => [s.id, s]));
		expect(channels.map(c => c.id)).to.deep.equal(['info', 'valve1']);
		expect(byId['info.online'].value).to.equal(true);
		expect(byId['info.battery'].value).to.equal(86);
		expect(byId['info.battery'].common.role).to.equal('value.battery');
		expect(byId['info.temperature'].common.unit).to.equal('°C');
		expect(byId['info.frostWarning'].value).to.equal(false);
		expect(byId['valve1.open'].value).to.equal(false);
		expect(byId['valve1.open'].common.role).to.equal('switch');
		expect(byId['valve1.source'].value).to.equal('off');
		expect(byId['valve1.buttonTime'].value).to.equal(30);
		expect(byId['valve1.duration'].value).to.equal(undefined);
		expect(byId['valve1.open'].ts).to.equal(1700000000000);
	});

	it('detects manual and scheduled watering', () => {
		const manual = Object.fromEntries(buildDevice(waterControl1(600)).states.map(s => [s.id, s.value]));
		expect(manual['valve1.open']).to.equal(true);
		expect(manual['valve1.source']).to.equal('manual');
		const scheduled = Object.fromEntries(buildDevice(waterControl1(-600)).states.map(s => [s.id, s.value]));
		expect(scheduled['valve1.source']).to.equal('schedule');
	});

	it('builds a Gen2 Water Control with actuator instances', () => {
		const dev: DeviceSnapshot = {
			id: 'WC2',
			kind: 'waterControl2',
			service: 'lwm2mserver',
			tree: {
				sg_common: { 0: { name: f({ vs: 'Hochbeet' }) } },
				device: { 0: { battery_level: f({ vi: 50 }) } },
				temperature: { 0: { sensor_value: f({ vf: 3.25 }) } },
				connectivity_monitoring: { 0: { link_quality: f({ vi: 1 }) } },
				actuator: {
					0: {
						state: f({ vi: 2 }),
						available: f({ vb: true }),
						error: f({ vi: 0 }),
						default_duration_seconds: f({ vi: 600 }),
					},
				},
			},
		};
		expect(deviceName(dev)).to.equal('Hochbeet');
		const byId = Object.fromEntries(buildDevice(dev).states.map(s => [s.id, s.value]));
		expect(byId['valve1.open']).to.equal(true);
		expect(byId['valve1.state']).to.equal(2);
		expect(byId['valve1.buttonTime']).to.equal(10);
		expect(byId['info.signal']).to.equal(50);
		expect(byId['info.temperature']).to.equal(3.3);
		expect(byId['info.frostWarning']).to.equal(true);
	});

	it('builds a Gen1 Sensor', () => {
		const dev: DeviceSnapshot = {
			id: 'S1',
			kind: 'sensor1',
			service: 'lemonbeatd',
			tree: {
				lemonbeat: {
					0: {
						soil_humidity: f({ vi: 42 }),
						soil_temperature: f({ vi: 12 }),
						light: f({ vi: 1000 }),
						ambient_temperature: f({ vi: 9 }),
					},
				},
			},
		};
		const byId = Object.fromEntries(buildDevice(dev).states.map(s => [s.id, s]));
		expect(byId['sensor.soilMoisture'].value).to.equal(42);
		expect(byId['sensor.soilMoisture'].common.role).to.equal('value.humidity');
		expect(byId['sensor.light'].common.role).to.equal('value.brightness');
		expect(byId['sensor.measure'].common.role).to.equal('button');
	});

	it('creates raw states with safe ids', () => {
		const raw = buildRawStates(waterControl1(0));
		const ids = raw.map(r => r.id);
		expect(ids).to.include('raw.lemonbeat.0.battery_level');
		expect(ids.every(id => /^[A-Za-z0-9_.-]+$/.test(id))).to.equal(true);
	});
});
