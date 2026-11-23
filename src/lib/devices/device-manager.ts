import type { GatewayClient } from '../local/gateway-client';
import { type GatewayEvent, deleteAtPath, encodeStringArray, mergeAtPath } from '../local/protocol';
import { GEN1_COMMAND, GEN2_COMMAND_SOURCE, MODEL_KINDS } from './models';
import { fieldValue, getField } from '../local/protocol';
import { type DeviceSnapshot, type StateSpec, buildDevice, buildRawStates, deviceName } from './states';

/**
 * Serial number encoded in the local device id (fallback when a device reports another serial).
 *
 * @param id local device id
 * @returns serial number or null if the id is no SGTIN-96
 */
export function serialFromDeviceId(id: string): string | null {
	// @KI_HINWEIS: The gateway names devices by their SGTIN-96 EPC (24 hex digits). The last 38 bits are the
	// serial number the GARDENA app/cloud shows, padded to 8 digits (verified: 3034F8EE90126D400003C557 → 00247127).
	if (!/^30[0-9A-Fa-f]{22}$/.test(id)) {
		return null;
	}
	const serial = BigInt(`0x${id}`) & ((1n << 38n) - 1n);
	return serial.toString().padStart(8, '0');
}

/** Root folder of all devices */
export const DEVICES_FOLDER = 'devices';

/** Maximum watering / switch-on time the gateway accepts: 10 hours */
const MAX_SECONDS = 36_000;

/**
 * Keeps the data of all devices, creates the ioBroker objects and executes commands.
 */
export class DeviceManager {
	private readonly devices = new Map<string, DeviceSnapshot>();
	/** ids of objects already created/updated in this adapter run */
	private readonly knownObjects = new Set<string>();

	/**
	 * @param adapter adapter instance
	 * @param client connection to the gateway
	 * @param rawStates also create states for all raw values (expert option)
	 */
	public constructor(
		private readonly adapter: ioBroker.Adapter,
		private readonly client: GatewayClient,
		private readonly rawStates: boolean,
	) {}

	/** Number of known devices */
	public get count(): number {
		return this.devices.size;
	}

	/**
	 * Takes over the result of a discovery and updates all devices.
	 *
	 * @param discovered devices reported by the gateway
	 */
	public async sync(
		discovered: Map<string, { service: 'lemonbeatd' | 'lwm2mserver'; tree: Record<string, unknown> }>,
	): Promise<void> {
		await this.ensureObject(DEVICES_FOLDER, { type: 'folder', common: { name: 'Devices' }, native: {} });
		for (const [id, { service, tree }] of discovered) {
			const modelNumber = String((tree as any)?.device?.['0']?.model_number?.vs ?? '');
			const kind = MODEL_KINDS[modelNumber] ?? 'unknown';
			if (kind === 'unknown') {
				this.adapter.log.info(
					`Device ${id} with model number ${modelNumber || '?'} is not supported yet, only general information is shown. ` +
						'Please open an issue on GitHub with the "raw" values (enable "raw values" in the settings).',
				);
			}
			const dev: DeviceSnapshot = { id, kind, service, tree };
			this.devices.set(id, dev);
			await this.updateDevice(dev, true);
		}
	}

	/**
	 * Applies an event pushed by the gateway.
	 *
	 * @param event gateway event
	 * @returns false if the device is unknown (a new discovery is needed)
	 */
	public async applyEvent(event: GatewayEvent): Promise<boolean> {
		const deviceId = event.entity.device;
		if (!deviceId) {
			return true;
		}
		const dev = this.devices.get(deviceId);
		if (!dev) {
			return false;
		}
		if (event.op === 'delete') {
			deleteAtPath(dev.tree, event.entity.path);
		} else if (event.payload) {
			mergeAtPath(dev.tree, event.entity.path, event.payload, event.op === 'overwrite');
		}
		await this.updateDevice(dev, false);
		return true;
	}

	/**
	 * Takes over the names from the GARDENA app (matched by serial number). A name the user has changed in
	 * ioBroker is kept: only the automatically created name (type + serial number) is replaced.
	 *
	 * @param namesBySerial device name per serial number
	 * @returns number of devices renamed
	 */
	public async applyNames(namesBySerial: Map<string, string>): Promise<number> {
		let renamed = 0;
		for (const dev of this.devices.values()) {
			const serial = fieldValue(getField(dev.tree, 'device', '0', 'serial_number'));
			const name =
				(serial !== null ? namesBySerial.get(String(serial)) : undefined) ??
				namesBySerial.get(serialFromDeviceId(dev.id) ?? '');
			if (!name) {
				continue;
			}
			const id = `${DEVICES_FOLDER}.${dev.id}`;
			const obj = await this.adapter.getObjectAsync(id);
			const current = obj?.common?.name;
			if (current === name) {
				continue;
			}
			if (obj && typeof current === 'string' && current !== deviceName(dev)) {
				continue;
			}
			await this.adapter.extendObject(id, { common: { name } });
			renamed++;
		}
		return renamed;
	}

	/** Sets all devices offline (e.g. connection to the gateway lost). */
	public async setAllOffline(): Promise<void> {
		for (const id of this.devices.keys()) {
			await this.adapter.setStateChangedAsync(`${DEVICES_FOLDER}.${id}.info.online`, false, true);
		}
	}

	private async updateDevice(dev: DeviceSnapshot, full: boolean): Promise<void> {
		const base = `${DEVICES_FOLDER}.${dev.id}`;
		await this.ensureObject(base, {
			type: 'device',
			common: {
				name: deviceName(dev),
				statusStates: { onlineId: `${this.adapter.namespace}.${base}.info.online` },
			},
			native: { kind: dev.kind, service: dev.service },
		});
		const { channels, states } = buildDevice(dev);
		for (const ch of channels) {
			await this.ensureObject(`${base}.${ch.id}`, { type: 'channel', common: { name: ch.name }, native: {} });
		}
		const all: StateSpec[] = this.rawStates ? [...states, ...buildRawStates(dev)] : states;
		if (this.rawStates) {
			await this.ensureObject(`${base}.raw`, {
				type: 'channel',
				common: { name: 'Raw values (expert)' },
				native: {},
			});
		}
		for (const spec of all) {
			const id = `${base}.${spec.id}`;
			if (!this.knownObjects.has(id)) {
				await this.adapter.extendObject(id, {
					type: 'state',
					common: spec.common as ioBroker.StateCommon,
					native: {},
				});
				this.knownObjects.add(id);
				if (spec.value === undefined && spec.common.def !== undefined) {
					// adapter owned setting (e.g. duration): initialise once
					const existing = await this.adapter.getStateAsync(id);
					if (!existing || existing.val === null) {
						await this.adapter.setState(id, spec.common.def as ioBroker.StateValue, true);
					}
				}
			}
			if (spec.value !== undefined && (spec.value !== null || full)) {
				await this.adapter.setStateChangedAsync(id, {
					val: spec.value,
					ack: true,
					...(spec.ts ? { ts: spec.ts } : {}),
				});
			}
		}
		if (full) {
			await this.removeObsolete(base, new Set(all.map(spec => `${base}.${spec.id}`)));
		}
	}

	/**
	 * Deletes states of a device that the adapter no longer creates (e.g. after an update or when the raw
	 * values were switched off in the settings).
	 *
	 * @param base device object id (relative)
	 * @param wanted relative ids of all states that should exist
	 */
	private async removeObsolete(base: string, wanted: Set<string>): Promise<void> {
		const prefix = `${this.adapter.namespace}.${base}.`;
		const view = await this.adapter.getObjectViewAsync('system', 'state', {
			startkey: prefix,
			endkey: `${prefix}\u9999`,
		});
		for (const row of view.rows) {
			const rel = row.id.slice(this.adapter.namespace.length + 1);
			if (wanted.has(rel) || (this.rawStates && rel.startsWith(`${base}.raw.`))) {
				continue;
			}
			await this.adapter.delObjectAsync(rel);
			this.knownObjects.delete(rel);
			this.adapter.log.debug(`Removed obsolete state ${rel}`);
		}
		if (!this.rawStates && (await this.adapter.getObjectAsync(`${base}.raw`))) {
			await this.adapter.delObjectAsync(`${base}.raw`, { recursive: true });
			this.knownObjects.delete(`${base}.raw`);
		}
	}

	private async ensureObject(id: string, obj: ioBroker.SettableObject): Promise<void> {
		if (this.knownObjects.has(id)) {
			return;
		}
		if (obj.type === 'device') {
			// keep a name the user has changed
			await this.adapter.setObjectNotExistsAsync(id, obj);
			await this.adapter.extendObject(id, {
				native: obj.native,
				common: { statusStates: (obj.common as any).statusStates },
			});
		} else {
			await this.adapter.extendObject(id, obj);
		}
		this.knownObjects.add(id);
	}

	/**
	 * Executes a command written by the user.
	 *
	 * @param id full state id
	 * @param state new state (ack = false)
	 */
	public async handleCommand(id: string, state: ioBroker.State): Promise<void> {
		const rel = id.slice(this.adapter.namespace.length + 1);
		const parts = rel.split('.');
		if (parts[0] !== DEVICES_FOLDER || parts.length < 3) {
			return;
		}
		const dev = this.devices.get(parts[1]);
		if (!dev) {
			this.adapter.log.warn(`Unknown device ${parts[1]}`);
			return;
		}
		const channel = parts[2];
		const name = parts[3] ?? '';
		const gen1 = dev.service === 'lemonbeatd';

		// adapter owned settings are only stored
		if (name === 'duration') {
			await this.adapter.setState(id, state.val, true);
			return;
		}
		// @KI_HINWEIS: Commands to offline devices are not sent. The gateway might queue them and execute
		// them much later (e.g. a valve opening when the device is mounted again in spring).
		if (fieldValue(getField(dev.tree, 'connection_status', '0', 'online')) === false) {
			this.adapter.log.warn(`${deviceName(dev)} is offline, command ${channel}.${name} was not sent`);
			await this.restore(dev, id);
			return;
		}

		try {
			if (channel === 'info' && name === 'identify') {
				if (gen1) {
					await this.gen1Command(dev, GEN1_COMMAND.identify);
				} else {
					await this.client.execute(dev.service, dev.id, 'sg_common/0/identify');
				}
			} else if (channel === 'closeAll') {
				if (gen1) {
					await this.gen1Command(dev, GEN1_COMMAND.closeAllValves);
				} else {
					await this.client.execute(dev.service, dev.id, 'sg_common/0/stop_all_actuators', {
						as: encodeStringArray([GEN2_COMMAND_SOURCE]),
					});
				}
			} else if (/^valve\d+$/.test(channel)) {
				await this.valveCommand(dev, Number(channel.slice(5)), name, state, id);
				return;
			} else if (channel === 'sensor' && name === 'measure') {
				await this.gen1Command(dev, GEN1_COMMAND.measureSoilMoisture);
				await this.gen1Command(dev, GEN1_COMMAND.measureSoilTemperature);
				if (dev.kind === 'sensor1') {
					await this.gen1Command(dev, GEN1_COMMAND.measureLight);
					await this.gen1Command(dev, GEN1_COMMAND.measureAmbientTemperature);
				}
			} else if (channel === 'power') {
				await this.timerSwitch(dev, 'power_timer', name, state, id, 60);
				return;
			} else if (channel === 'pump') {
				if (name === 'operatingMode') {
					await this.client.write(dev.service, dev.id, 'lemonbeat/0/operating_mode', {
						vi: Number(state.val) ? 1 : 0,
					});
				} else {
					await this.timerSwitch(dev, 'watering_timer_1', name, state, id, 30);
					return;
				}
			} else if (channel === 'mower') {
				await this.mowerCommand(dev, name, id);
			} else {
				return;
			}
			this.adapter.log.debug(`Command ${rel} sent`);
		} catch (err) {
			this.adapter.log.warn(`Command ${rel} failed: ${(err as Error).message}`);
		}
	}

	private async valveCommand(
		dev: DeviceSnapshot,
		valve: number,
		name: string,
		state: ioBroker.State,
		id: string,
	): Promise<void> {
		const base = id.slice(0, id.lastIndexOf('.'));
		const gen1 = dev.service === 'lemonbeatd';
		try {
			if (name === 'open') {
				const open = state.val === true || state.val === 'true' || state.val === 1;
				const seconds = open ? await this.durationSeconds(`${base}.duration`, 30) : 0;
				if (gen1) {
					await this.client.write(dev.service, dev.id, `lemonbeat/0/watering_timer_${valve}`, {
						vi: seconds,
					});
				} else if (open) {
					await this.client.execute(dev.service, dev.id, `actuator/${valve - 1}/start`, {
						as: encodeStringArray([GEN2_COMMAND_SOURCE, String(seconds)]),
					});
				} else {
					await this.client.execute(dev.service, dev.id, `actuator/${valve - 1}/stop`, {
						as: encodeStringArray([GEN2_COMMAND_SOURCE]),
					});
				}
				this.adapter.log.info(
					open
						? `Valve ${valve} of ${deviceName(dev)} opened for ${seconds / 60} min`
						: `Valve ${valve} of ${deviceName(dev)} closed`,
				);
				// the gateway confirms the new valve state with an event (ack = true)
			} else if (name === 'buttonTime') {
				const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round(Number(state.val) * 60)));
				if (gen1) {
					await this.client.write(dev.service, dev.id, 'lemonbeat/0/button_config_time', { vi: seconds });
				} else {
					await this.client.write(dev.service, dev.id, `actuator/${valve - 1}/default_duration_seconds`, {
						vi: seconds,
					});
				}
			}
		} catch (err) {
			this.adapter.log.warn(`Valve ${valve} of ${deviceName(dev)}: ${(err as Error).message}`);
			await this.restore(dev, id);
		}
	}

	/**
	 * Switches a Gen1 timer resource (Power Adapter, Pump): >0 = on for seconds, 0 = off.
	 *
	 * @param dev device
	 * @param resource timer resource in `lemonbeat/0`
	 * @param name state name (`on`)
	 * @param state new state
	 * @param id full state id
	 * @param defaultMinutes fallback duration
	 */
	private async timerSwitch(
		dev: DeviceSnapshot,
		resource: string,
		name: string,
		state: ioBroker.State,
		id: string,
		defaultMinutes: number,
	): Promise<void> {
		if (name !== 'on') {
			return;
		}
		try {
			const on = state.val === true || state.val === 'true' || state.val === 1;
			const seconds = on ? await this.durationSeconds(id.replace(/\.on$/, '.duration'), defaultMinutes) : 0;
			await this.client.write(dev.service, dev.id, `lemonbeat/0/${resource}`, { vi: seconds });
			this.adapter.log.info(
				on ? `${deviceName(dev)} switched on for ${seconds / 60} min` : `${deviceName(dev)} switched off`,
			);
		} catch (err) {
			this.adapter.log.warn(`${deviceName(dev)}: ${(err as Error).message}`);
			await this.restore(dev, id);
		}
	}

	/**
	 * Mower commands for Gen1 (Lemonbeat) and Gen2 (LwM2M) mowers.
	 *
	 * @param dev device
	 * @param name command (start, parkUntilNextTask, parkUntilFurtherNotice, pause)
	 * @param id full state id
	 */
	private async mowerCommand(dev: DeviceSnapshot, name: string, id: string): Promise<void> {
		const gen1 = dev.service === 'lemonbeatd';
		const seconds = name === 'start' ? await this.durationSeconds(id.replace(/\.start$/, '.duration'), 60) : 0;
		if (name === 'start' || name === 'parkUntilNextTask') {
			if (!gen1) {
				await this.client.execute(dev.service, dev.id, 'smart_system_mower_api/0/manual_start', {
					as: encodeStringArray([String(seconds)]),
				});
			} else if (getField(dev.tree, 'lemonbeat', '0', 'mower_timer')) {
				await this.client.write(dev.service, dev.id, 'lemonbeat/0/mower_timer', { vi: seconds });
			} else {
				// LONA mowers: 2 bytes distance from the charging station (0 = default) + 4 bytes seconds, big endian
				const data = Buffer.alloc(6);
				data.writeUInt32BE(seconds, 2);
				await this.client.write(dev.service, dev.id, 'lemonbeat/0/mower_timer_with_distance', {
					vo: data.toString('base64'),
				});
			}
		} else if (name === 'parkUntilFurtherNotice') {
			if (gen1) {
				// pause the schedule until a date far in the future (2042-12-31 22:00): year little endian, month, day, hour, minute
				const data = Buffer.from([2042 & 0xff, 2042 >> 8, 12, 31, 22, 0]);
				await this.client.write(dev.service, dev.id, 'lemonbeat/0/action_paused_until_1', {
					vo: data.toString('base64'),
				});
			} else {
				await this.client.execute(dev.service, dev.id, 'smart_system_mower_api/0/park_until_further_notice');
			}
		} else if (name === 'pause' && !gen1) {
			await this.client.execute(dev.service, dev.id, 'mower_app/0/pause');
		} else {
			return;
		}
		this.adapter.log.info(`${deviceName(dev)}: ${name}${name === 'start' ? ` for ${seconds / 60} min` : ''}`);
	}

	private async durationSeconds(durationId: string, defaultMinutes: number): Promise<number> {
		const st = await this.adapter.getStateAsync(durationId);
		const minutes = typeof st?.val === 'number' && st.val > 0 ? st.val : defaultMinutes;
		return Math.min(MAX_SECONDS, Math.max(1, Math.round(minutes * 60)));
	}

	private async gen1Command(dev: DeviceSnapshot, command: number): Promise<void> {
		await this.client.write('lemonbeatd', dev.id, 'lemonbeat/0/command', { vi: command });
	}

	/**
	 * Writes the actual device value back after a failed command.
	 *
	 * @param dev device
	 * @param id full state id
	 */
	private async restore(dev: DeviceSnapshot, id: string): Promise<void> {
		const rel = id.slice(`${this.adapter.namespace}.${DEVICES_FOLDER}.${dev.id}.`.length);
		const spec = buildDevice(dev).states.find(s => s.id === rel);
		if (spec && spec.value !== undefined) {
			await this.adapter.setState(id, { val: spec.value, ack: true });
		}
	}
}
