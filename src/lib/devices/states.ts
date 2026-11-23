import {
	type ResourceValue,
	type ValueField,
	decodeIntArray,
	decodeOpaqueText,
	fieldValue,
	getField,
	instanceIds,
	isValueField,
} from '../local/protocol';
import {
	type DeviceKind,
	GEN1_MOWER_STATUS,
	GEN2_ACTUATOR_STATES,
	GEN2_FROST_TEMPERATURE,
	GEN2_LINK_QUALITY_PERCENT,
	GEN2_MOWER_ACTIVITY,
} from './models';

/** Translated name */
type Name = ioBroker.StringOrTranslated;

/** Definition of one ioBroker state of a device, together with its current value. */
export interface StateSpec {
	/** id relative to the device, e.g. `valve1.open` */
	id: string;
	/** Common part of the ioBroker object */
	common: Partial<ioBroker.StateCommon> & { name: Name; type: ioBroker.CommonType; role: string };
	/** current value; undefined = adapter owned state (e.g. duration), value is not touched */
	value?: ResourceValue;
	/** timestamp of the value in ms */
	ts?: number;
}

/** Definition of a channel of a device. */
export interface ChannelSpec {
	/** Id relative to the device */
	id: string;
	/** Display name */
	name: Name;
}

/** Everything the adapter needs to know about one device. */
export interface DeviceSnapshot {
	/** Id relative to the device */
	id: string;
	/** Device family */
	kind: DeviceKind;
	/** Gateway service (lemonbeatd = Gen1, lwm2mserver = Gen2) */
	service: 'lemonbeatd' | 'lwm2mserver';
	/** Raw data of the device */
	tree: Record<string, unknown>;
}

const n = (en: string, de: string): Name => ({ en, de });

function v(
	tree: Record<string, unknown>,
	object: string,
	instance: string,
	resource: string,
): { value: ResourceValue; ts?: number } {
	const field: ValueField | undefined = getField(tree, object, instance, resource);
	return { value: fieldValue(field), ts: field?.ts ? field.ts * 1000 : undefined };
}

function num(value: ResourceValue): number | null {
	return typeof value === 'number' ? value : null;
}

/**
 * Display name of a device: user defined name (Gen2) or device type + serial number.
 *
 * @param dev device
 */
export function deviceName(dev: DeviceSnapshot): string {
	const userName = v(dev.tree, 'sg_common', '0', 'name').value;
	if (typeof userName === 'string' && userName.trim()) {
		return userName.trim();
	}
	const type = v(dev.tree, 'device', '0', 'device_type').value;
	const serial = v(dev.tree, 'device', '0', 'serial_number').value;
	return [type || 'GARDENA device', serial].filter(Boolean).join(' ');
}

/**
 * Builds channels and states of a device from its current data.
 *
 * @param dev device
 */
export function buildDevice(dev: DeviceSnapshot): { channels: ChannelSpec[]; states: StateSpec[] } {
	const channels: ChannelSpec[] = [{ id: 'info', name: n('Device information', 'Geräteinformationen') }];
	const states: StateSpec[] = [];
	const t = dev.tree;
	const gen1 = dev.service === 'lemonbeatd';

	// ---------- info ----------
	const online = v(t, 'connection_status', '0', 'online');
	states.push({
		id: 'info.online',
		common: { name: n('Online', 'Online'), type: 'boolean', role: 'indicator.reachable', read: true, write: false },
		value: typeof online.value === 'boolean' ? online.value : null,
		ts: online.ts,
	});
	for (const [res, id, name] of [
		['device_type', 'model', n('Model', 'Modell')],
		['serial_number', 'serial', n('Serial number', 'Seriennummer')],
		['software_version', 'firmware', n('Firmware version', 'Firmware-Version')],
	] as const) {
		states.push({
			id: `info.${id}`,
			common: { name, type: 'string', role: 'text', read: true, write: false },
			value: v(t, 'device', '0', res).value?.toString() ?? null,
		});
	}

	const battery = gen1 ? v(t, 'lemonbeat', '0', 'battery_level') : v(t, 'device', '0', 'battery_level');
	if (battery.value !== null) {
		states.push({
			id: 'info.battery',
			common: {
				name: n('Battery', 'Batterie'),
				type: 'number',
				role: 'value.battery',
				unit: '%',
				min: 0,
				max: 100,
				read: true,
				write: false,
			},
			value: num(battery.value),
			ts: battery.ts,
		});
	}

	if (gen1) {
		const rf = v(t, 'lemonbeat', '0', 'rf_link_quality');
		if (rf.value !== null) {
			states.push({
				id: 'info.signal',
				common: {
					name: n('Radio signal', 'Funksignal'),
					type: 'number',
					role: 'value',
					unit: '%',
					min: 0,
					max: 100,
					read: true,
					write: false,
				},
				value: num(rf.value),
				ts: rf.ts,
			});
		}
		const frost = v(t, 'lemonbeat', '0', 'frost_warning');
		if (frost.value !== null) {
			states.push({
				id: 'info.frostWarning',
				common: {
					name: n('Frost warning', 'Frostwarnung'),
					type: 'boolean',
					role: 'indicator.alarm',
					read: true,
					write: false,
				},
				value: frost.value === 1 || frost.value === true,
				ts: frost.ts,
			});
		}
	} else {
		const lq = v(t, 'connectivity_monitoring', '0', 'link_quality');
		if (lq.value !== null) {
			states.push({
				id: 'info.signal',
				common: {
					name: n('Radio signal', 'Funksignal'),
					type: 'number',
					role: 'value',
					unit: '%',
					min: 0,
					max: 100,
					read: true,
					write: false,
				},
				value: typeof lq.value === 'number' ? (GEN2_LINK_QUALITY_PERCENT[lq.value] ?? 0) : null,
				ts: lq.ts,
			});
		}
		const temp = v(t, 'temperature', '0', 'sensor_value');
		if (typeof temp.value === 'number') {
			states.push({
				id: 'info.temperature',
				common: {
					name: n('Temperature', 'Temperatur'),
					type: 'number',
					role: 'value.temperature',
					unit: '°C',
					read: true,
					write: false,
				},
				value: Math.round(temp.value * 10) / 10,
				ts: temp.ts,
			});
			states.push({
				id: 'info.frostWarning',
				common: {
					name: n('Frost warning', 'Frostwarnung'),
					type: 'boolean',
					role: 'indicator.alarm',
					read: true,
					write: false,
				},
				value: temp.value < GEN2_FROST_TEMPERATURE,
				ts: temp.ts,
			});
		}
	}
	states.push({
		id: 'info.identify',
		common: {
			name: n('Identify (LED flashes)', 'Identifizieren (LED blinkt)'),
			type: 'boolean',
			role: 'button',
			read: false,
			write: true,
		},
	});

	// ---------- device specific ----------
	switch (dev.kind) {
		case 'waterControl1':
			addAmbientTemperature(t, states);
			addGen1Valves(t, 1, channels, states, true);
			break;
		case 'irrigationControl1':
			addGen1Valves(t, 6, channels, states, false);
			addCloseAll(states);
			break;
		case 'waterControl2':
		case 'irrigationControl2':
			addGen2Valves(t, channels, states);
			if (dev.kind === 'irrigationControl2') {
				addCloseAll(states);
			}
			break;
		case 'sensor1':
		case 'sensor2':
			addSensor(t, dev.kind, channels, states);
			break;
		case 'powerAdapter':
			addPowerAdapter(t, channels, states);
			break;
		case 'mower1':
		case 'mower2':
			addMowerStatus(t, dev.kind, channels, states);
			break;
		default:
			break;
	}
	return { channels, states };
}

function addAmbientTemperature(t: Record<string, unknown>, states: StateSpec[]): void {
	const temp = v(t, 'lemonbeat', '0', 'ambient_temperature');
	if (temp.value !== null) {
		states.push({
			id: 'info.temperature',
			common: {
				name: n('Temperature', 'Temperatur'),
				type: 'number',
				role: 'value.temperature',
				unit: '°C',
				read: true,
				write: false,
			},
			value: num(temp.value),
			ts: temp.ts,
		});
	}
}

function valveControls(states: StateSpec[], ch: string, open: boolean | null, ts: number | undefined): void {
	states.push({
		id: `${ch}.open`,
		common: {
			name: n('Open valve (true = open, false = close)', 'Ventil öffnen (true = auf, false = zu)'),
			type: 'boolean',
			role: 'switch',
			read: true,
			write: true,
		},
		value: open,
		ts,
	});
	states.push({
		id: `${ch}.duration`,
		common: {
			name: n('Watering time when opened via "open"', 'Bewässerungsdauer beim Öffnen über "open"'),
			type: 'number',
			role: 'level.timer',
			unit: 'min',
			min: 1,
			max: 600,
			def: 30,
			read: true,
			write: true,
		},
	});
}

function addGen1Valves(
	t: Record<string, unknown>,
	count: number,
	channels: ChannelSpec[],
	states: StateSpec[],
	waterControl: boolean,
): void {
	const connected = num(v(t, 'lemonbeat', '0', 'valves_connected').value);
	for (let i = 1; i <= count; i++) {
		const ch = `valve${i}`;
		let name = count === 1 ? 'Valve' : `Valve ${i}`;
		const opaqueName = v(t, 'lemonbeat', '0', `valve_name_${i}`).value;
		if (typeof opaqueName === 'string' && opaqueName) {
			const decoded = decodeOpaqueText(opaqueName);
			if (decoded) {
				name = decoded;
			}
		}
		channels.push({ id: ch, name });
		const timer = v(t, 'lemonbeat', '0', `watering_timer_${i}`);
		const timerValue = num(timer.value);
		// "open" mirrors the actual valve state
		valveControls(states, ch, timerValue === null ? null : timerValue !== 0, timer.ts);
		states.push({
			id: `${ch}.active`,
			common: {
				name: n('Watering active', 'Bewässerung läuft'),
				type: 'boolean',
				role: 'indicator.working',
				read: true,
				write: false,
			},
			value: timerValue === null ? null : timerValue !== 0,
			ts: timer.ts,
		});
		states.push({
			id: `${ch}.source`,
			common: {
				name: n('Started by', 'Gestartet durch'),
				type: 'string',
				role: 'text',
				read: true,
				write: false,
				states: { off: 'off', manual: 'manual', schedule: 'schedule' },
			},
			value: timerValue === null ? null : timerValue === 0 ? 'off' : timerValue > 0 ? 'manual' : 'schedule',
			ts: timer.ts,
		});
		const error = v(t, 'lemonbeat', '0', `valve_error_${i}`);
		states.push({
			id: `${ch}.error`,
			common: {
				name: n('Error code (0 = no error)', 'Fehlercode (0 = kein Fehler)'),
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			value: num(error.value),
			ts: error.ts,
		});
		if (connected !== null) {
			states.push({
				id: `${ch}.connected`,
				common: {
					name: n('Valve connected', 'Ventil angeschlossen'),
					type: 'boolean',
					role: 'indicator',
					read: true,
					write: false,
				},
				value: (connected & (1 << i)) !== 0,
			});
		}
		if (waterControl) {
			const button = v(t, 'lemonbeat', '0', 'button_config_time');
			if (button.value !== null) {
				states.push({
					id: `${ch}.buttonTime`,
					common: {
						name: n(
							'Watering time when the button on the device is pressed',
							'Bewässerungsdauer bei Tastendruck am Gerät',
						),
						type: 'number',
						role: 'level.timer',
						unit: 'min',
						min: 0,
						max: 600,
						read: true,
						write: true,
					},
					value: typeof button.value === 'number' ? Math.round(button.value / 60) : null,
					ts: button.ts,
				});
			}
		}
	}
}

function addGen2Valves(t: Record<string, unknown>, channels: ChannelSpec[], states: StateSpec[]): void {
	const ids = instanceIds(t, 'actuator');
	const single = ids.length === 1;
	for (const id of ids) {
		const nr = Number(id) + 1;
		const ch = `valve${nr}`;
		const userName = v(t, 'actuator', id, 'name').value;
		channels.push({
			id: ch,
			name: typeof userName === 'string' && userName.trim() ? userName.trim() : single ? 'Valve' : `Valve ${nr}`,
		});
		const state = v(t, 'actuator', id, 'state');
		const stateNr = num(state.value);
		const active = stateNr === null ? null : stateNr === 1 || stateNr === 2;
		valveControls(states, ch, active, state.ts);
		states.push({
			id: `${ch}.active`,
			common: {
				name: n('Watering active', 'Bewässerung läuft'),
				type: 'boolean',
				role: 'indicator.working',
				read: true,
				write: false,
			},
			value: active,
			ts: state.ts,
		});
		states.push({
			id: `${ch}.state`,
			common: {
				name: n('Valve state', 'Ventilzustand'),
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				states: GEN2_ACTUATOR_STATES,
			},
			value: stateNr,
			ts: state.ts,
		});
		const available = v(t, 'actuator', id, 'available');
		if (available.value !== null) {
			states.push({
				id: `${ch}.connected`,
				common: {
					name: n('Valve connected', 'Ventil angeschlossen'),
					type: 'boolean',
					role: 'indicator',
					read: true,
					write: false,
				},
				value: available.value === true,
				ts: available.ts,
			});
		}
		const error = v(t, 'actuator', id, 'error');
		states.push({
			id: `${ch}.error`,
			common: {
				name: n('Error code (0 = no error)', 'Fehlercode (0 = kein Fehler)'),
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			value: num(error.value),
			ts: error.ts,
		});
		const button = v(t, 'actuator', id, 'default_duration_seconds');
		if (button.value !== null) {
			states.push({
				id: `${ch}.buttonTime`,
				common: {
					name: n(
						'Watering time when the button on the device is pressed',
						'Bewässerungsdauer bei Tastendruck am Gerät',
					),
					type: 'number',
					role: 'level.timer',
					unit: 'min',
					min: 0,
					max: 600,
					read: true,
					write: true,
				},
				value: typeof button.value === 'number' ? Math.round(button.value / 60) : null,
				ts: button.ts,
			});
		}
	}
}

function addCloseAll(states: StateSpec[]): void {
	states.push({
		id: 'closeAll',
		common: {
			name: n('Close all valves', 'Alle Ventile schließen'),
			type: 'boolean',
			role: 'button',
			read: false,
			write: true,
		},
	});
}

function addSensor(t: Record<string, unknown>, kind: DeviceKind, channels: ChannelSpec[], states: StateSpec[]): void {
	channels.push({ id: 'sensor', name: n('Measured values', 'Messwerte') });
	const moisture = v(t, 'lemonbeat', '0', kind === 'sensor1' ? 'soil_humidity' : 'soil_moisture');
	states.push({
		id: 'sensor.soilMoisture',
		common: {
			name: n('Soil moisture', 'Bodenfeuchte'),
			type: 'number',
			role: 'value.humidity',
			unit: '%',
			min: 0,
			max: 100,
			read: true,
			write: false,
		},
		value: num(moisture.value),
		ts: moisture.ts,
	});
	const soilTemp = v(t, 'lemonbeat', '0', 'soil_temperature');
	states.push({
		id: 'sensor.soilTemperature',
		common: {
			name: n('Soil temperature', 'Bodentemperatur'),
			type: 'number',
			role: 'value.temperature',
			unit: '°C',
			read: true,
			write: false,
		},
		value: num(soilTemp.value),
		ts: soilTemp.ts,
	});
	if (kind === 'sensor1') {
		const light = v(t, 'lemonbeat', '0', 'light');
		states.push({
			id: 'sensor.light',
			common: {
				name: n('Light intensity', 'Lichtstärke'),
				type: 'number',
				role: 'value.brightness',
				unit: 'lx',
				min: 0,
				read: true,
				write: false,
			},
			value: num(light.value),
			ts: light.ts,
		});
		const amb = v(t, 'lemonbeat', '0', 'ambient_temperature');
		states.push({
			id: 'sensor.temperature',
			common: {
				name: n('Air temperature', 'Lufttemperatur'),
				type: 'number',
				role: 'value.temperature',
				unit: '°C',
				read: true,
				write: false,
			},
			value: num(amb.value),
			ts: amb.ts,
		});
	}
	states.push({
		id: 'sensor.measure',
		common: { name: n('Measure now', 'Jetzt messen'), type: 'boolean', role: 'button', read: false, write: true },
	});
}

function addPowerAdapter(t: Record<string, unknown>, channels: ChannelSpec[], states: StateSpec[]): void {
	channels.push({ id: 'power', name: n('Power socket', 'Steckdose') });
	const timer = v(t, 'lemonbeat', '0', 'power_timer');
	const timerValue = num(timer.value);
	states.push({
		id: 'power.on',
		common: {
			name: n('Power on (true = on, false = off)', 'Strom an (true = an, false = aus)'),
			type: 'boolean',
			role: 'switch',
			read: true,
			write: true,
		},
		value: timerValue === null ? null : timerValue !== 0,
		ts: timer.ts,
	});
	states.push({
		id: 'power.duration',
		common: {
			name: n('Switch-on time when switched on via "on"', 'Einschaltdauer beim Einschalten über "on"'),
			type: 'number',
			role: 'level.timer',
			unit: 'min',
			min: 1,
			max: 1440,
			def: 60,
			read: true,
			write: true,
		},
	});
}

function addMowerStatus(
	t: Record<string, unknown>,
	kind: DeviceKind,
	channels: ChannelSpec[],
	states: StateSpec[],
): void {
	channels.push({ id: 'mower', name: n('Mower', 'Mähroboter') });
	if (kind === 'mower1') {
		const status = v(t, 'lemonbeat', '0', 'status');
		states.push({
			id: 'mower.status',
			common: {
				name: n('Status', 'Status'),
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				states: GEN1_MOWER_STATUS,
			},
			value: num(status.value),
			ts: status.ts,
		});
	} else {
		const activity = v(t, 'mower_app', '0', 'activity');
		states.push({
			id: 'mower.activity',
			common: {
				name: n('Activity', 'Aktivität'),
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				states: GEN2_MOWER_ACTIVITY,
			},
			value: num(activity.value),
			ts: activity.ts,
		});
	}
}

/**
 * Builds read-only states for all raw resources of a device (expert option).
 *
 * @param dev device
 */
export function buildRawStates(dev: DeviceSnapshot): StateSpec[] {
	const result: StateSpec[] = [];
	for (const [object, instances] of Object.entries(dev.tree)) {
		if (object === '_urn' || !instances || typeof instances !== 'object') {
			continue;
		}
		for (const [instance, resources] of Object.entries(instances as Record<string, unknown>)) {
			if (instance === '_urn' || !resources || typeof resources !== 'object') {
				continue;
			}
			for (const [resource, field] of Object.entries(resources as Record<string, unknown>)) {
				if (!isValueField(field)) {
					continue;
				}
				let type: ioBroker.CommonType = 'string';
				let role = 'text';
				let value = fieldValue(field);
				if (field.vb !== undefined) {
					type = 'boolean';
					role = 'indicator';
				} else if (field.vi !== undefined || field.vf !== undefined) {
					type = 'number';
					role = 'value';
				} else if (field.vt !== undefined) {
					type = 'number';
					role = 'value.time';
					value = field.vt * 1000;
				} else if (field.ai !== undefined) {
					value = decodeIntArray(field.ai).join(',');
				}
				result.push({
					id: `raw.${safe(object)}.${safe(instance)}.${safe(resource)}`,
					common: { name: `${object}/${instance}/${resource}`, type, role, read: true, write: false },
					value,
					ts: field.ts ? field.ts * 1000 : undefined,
				});
			}
		}
	}
	return result;
}

function safe(part: string): string {
	return part.replace(/[^A-Za-z0-9_-]/g, '_');
}
