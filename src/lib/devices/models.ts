/**
 * Known GARDENA smart device models of the local API.
 * The model number is reported by the device in `device/0/model_number`.
 */

/** Device families the adapter handles with own, user friendly states. */
export type DeviceKind =
	| 'waterControl1'
	| 'irrigationControl1'
	| 'sensor1'
	| 'sensor2'
	| 'powerAdapter'
	| 'pump'
	| 'mower1'
	| 'waterControl2'
	| 'irrigationControl2'
	| 'mower2'
	| 'unknown';

/** Model number -> device family */
export const MODEL_KINDS: Record<string, DeviceKind> = {
	// Gen1 (Lemonbeat)
	18869: 'waterControl1',
	31653: 'irrigationControl1',
	18845: 'sensor1',
	19040: 'sensor2',
	35279: 'powerAdapter',
	22538: 'pump',
	6146: 'mower1',
	29694: 'mower1',
	53988: 'mower1',
	// Gen2 (LwM2M)
	2812: 'waterControl2',
	2814: 'waterControl2',
	2826: 'waterControl2',
	469: 'irrigationControl2',
	488: 'mower2',
};

/** Gen1 commands, written to `lemonbeat/0/command`. */
export const GEN1_COMMAND = {
	measureSoilMoisture: 2,
	measureSoilTemperature: 3,
	measureLight: 4,
	measureAmbientTemperature: 5,
	measureBattery: 6,
	measureRfLink: 7,
	closeAllValves: 22,
	identify: 37,
} as const;

/** Source id the gateway uses for actions started via the local WebSocket API (Gen2 `execute` arguments). */
export const GEN2_COMMAND_SOURCE = '18';

/** Gen2 actuator (valve) states */
export const GEN2_ACTUATOR_STATES: Record<number, string> = {
	0: 'inactive',
	1: 'starting',
	2: 'active',
	3: 'stopping',
};

/** Gen1 mower status values */
export const GEN1_MOWER_STATUS: Record<number, string> = {
	0: 'PAUSED',
	1: 'OK_CUTTING_AUTO',
	2: 'OK_SEARCHING_CS',
	3: 'OK_CHARGING',
	4: 'OK_LEAVING_CS',
	5: 'WAIT_SOFTWARE_DOWNLOAD',
	6: 'WAIT_POWER_UP',
	7: 'PARKED_WEEK_TIMER',
	8: 'PARKED_BY_USER',
	9: 'OFF_MAIN_SWITCH',
	10: 'WAIT_STOP_PRESSED',
	11: 'UNKNOWN',
	12: 'ERROR',
	13: 'ERROR_POWER_UP',
	14: 'WAIT',
	15: 'OK_CUTTING_MANUAL',
	16: 'PARKED_AUTOTIMER',
	17: 'PARKED_DAY_LIMIT',
	18: 'PARKED_FROST',
};

/** Gen2 mower activity values (`mower_app/0/activity`) */
export const GEN2_MOWER_ACTIVITY: Record<number, string> = {
	0: 'NONE',
	1: 'CHARGING',
	2: 'GOING_OUT',
	3: 'MOWING',
	4: 'GOING_HOME',
	5: 'PARKED',
	6: 'STOPPED_IN_GARDEN',
};

/** Gen2 link quality levels -> percent, as shown in the GARDENA app */
export const GEN2_LINK_QUALITY_PERCENT: Record<number, number> = { 0: 20, 1: 50, 2: 90 };

/** Below this temperature (°C) the GARDENA app shows a frost warning for Gen2 devices. */
export const GEN2_FROST_TEMPERATURE = 5;
