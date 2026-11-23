/*
 * Message format of the local WebSocket API of the GARDENA smart Gateway.
 *
 * The gateway speaks JSON over a WebSocket. Every frame is a JSON array of messages.
 * Values are wrapped in "value fields" (`{ "vi": 12, "ts": 1700000000 }`), the key names the type.
 *
 * @KI_HINWEIS: Own implementation of the protocol. The official GARDENA library
 * (https://github.com/cloudless-garden/gardena-smart-local-api, LGPL-3.0) was only used as
 * protocol reference, no code was copied.
 */

/** Services of the gateway: Gen1 devices (Lemonbeat radio) and Gen2 devices (LwM2M). */
export type GatewayService = 'lemonbeatd' | 'lwm2mserver';

/** Value field as sent by the gateway. Exactly one value key is set, `ts` is optional. */
export interface ValueField {
	/** Boolean value */
	vb?: boolean;
	/** String value */
	vs?: string;
	/** Integer value */
	vi?: number;
	/** Float value */
	vf?: number;
	/** Opaque binary value, base64 encoded */
	vo?: string;
	/** Time value in seconds since UNIX epoch */
	vt?: number;
	/** Integer array, encoded as `["0=1,1=2"]` or as plain array */
	ai?: (number | string)[];
	/** String array, encoded as `["0='a',1='b'"]` or as plain array */
	as?: string[];
	/** Timestamp of the value in seconds since UNIX epoch */
	ts?: number;
}

/** Entity a message refers to. */
export interface Entity {
	/** Path like `devices`, `lemonbeat/0` or `actuator/1/state` */
	path: string;
	/** Gateway service (lemonbeatd = Gen1, lwm2mserver = Gen2) */
	service?: string;
	/** Device id (SGTIN) */
	device?: string;
}

/** Request sent to the gateway. */
export interface GatewayRequest {
	/** Entity the message refers to */
	entity: Entity;
	/** Operation */
	op: 'read' | 'write' | 'execute';
	/** Payload (value field or partial device tree) */
	payload?: ValueField;
	/** Id to match the reply to the request */
	request_id: string;
}

/** Event pushed by the gateway. */
export interface GatewayEvent {
	/** Entity the message refers to */
	entity: Entity;
	/** Operation */
	op: 'update' | 'overwrite' | 'delete';
	/** Payload (value field or partial device tree) */
	payload?: Record<string, unknown>;
}

/** Reply to a request. */
export interface GatewayReply {
	/** Entity the message refers to */
	entity?: Entity;
	/** Id to match the reply to the request */
	request_id: string;
	/** True if the gateway executed the request */
	success: boolean;
	/** Payload (value field or partial device tree) */
	payload?: Record<string, unknown>;
	/** Additional information of the gateway */
	metadata?: { error_source?: string };
}

/** One message of an incoming frame. */
export type IncomingMessage = GatewayEvent | GatewayReply;

/** Scalar value of a resource as used in ioBroker. */
export type ResourceValue = boolean | number | string | null;

/**
 * Returns true if the message is a reply to a request.
 *
 * @param msg incoming message
 */
export function isReply(msg: IncomingMessage): msg is GatewayReply {
	return typeof (msg as GatewayReply).request_id === 'string' && 'success' in msg;
}

/**
 * Returns true if the message is a pushed event.
 *
 * @param msg incoming message
 */
export function isEvent(msg: IncomingMessage): msg is GatewayEvent {
	const op = (msg as GatewayEvent).op;
	return op === 'update' || op === 'overwrite' || op === 'delete';
}

/**
 * Parses one WebSocket frame. Unknown or broken messages are skipped, never thrown.
 *
 * @param raw frame content
 */
export function parseFrame(raw: string): IncomingMessage[] {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) {
		return [];
	}
	return data.filter(
		(m): m is IncomingMessage =>
			!!m && typeof m === 'object' && !Array.isArray(m) && ('entity' in m || 'request_id' in m),
	);
}

/**
 * Returns true if the object looks like a value field (`{ vi: 1, ts: ... }`).
 *
 * @param obj any object of the device tree
 */
export function isValueField(obj: unknown): obj is ValueField {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		return false;
	}
	return ['vb', 'vs', 'vi', 'vf', 'vo', 'vt', 'ai', 'as'].some(k => k in obj);
}

/**
 * Extracts the value of a value field as ioBroker compatible scalar.
 * Arrays are returned as comma separated string, binary values as base64 string.
 *
 * @param field value field of the gateway
 */
export function fieldValue(field: ValueField | undefined): ResourceValue {
	if (!field) {
		return null;
	}
	if (field.vb !== undefined) {
		return field.vb;
	}
	if (field.vi !== undefined) {
		return field.vi;
	}
	if (field.vf !== undefined) {
		return field.vf;
	}
	if (field.vt !== undefined) {
		return field.vt;
	}
	if (field.vs !== undefined) {
		return field.vs;
	}
	if (field.vo !== undefined) {
		return field.vo;
	}
	if (field.ai !== undefined) {
		return decodeIntArray(field.ai).join(',');
	}
	if (field.as !== undefined) {
		return decodeStringArray(field.as).join(',');
	}
	return null;
}

/**
 * Decodes an integer array (`["0=1,1=2"]` or `[1, 2]`).
 *
 * @param value raw array
 */
export function decodeIntArray(value: (number | string)[]): number[] {
	if (value.length === 1 && typeof value[0] === 'string') {
		return [...value[0].matchAll(/\d+=(-?\d+)/g)].map(m => Number(m[1]));
	}
	return value.map(v => Number(v));
}

/**
 * Decodes a string array (`["0='a',1='b'"]` or `['a', 'b']`).
 *
 * @param value raw array
 */
export function decodeStringArray(value: string[]): string[] {
	if (value.length === 1) {
		const matches = [...value[0].matchAll(/\d+='(.*?)'(?:,|$)/g)].map(m => m[1]);
		if (matches.length) {
			return matches;
		}
	}
	return value;
}

/**
 * Encodes a string array the way the gateway expects it for `execute` arguments.
 *
 * @param values arguments
 */
export function encodeStringArray(values: string[]): string[] {
	return [values.map((v, i) => `${i}='${v}'`).join(',')];
}

/**
 * Decodes a base64 encoded UTF-8 string (e.g. valve names of the Irrigation Control),
 * trailing zero bytes are removed.
 *
 * @param base64 base64 value
 */
export function decodeOpaqueText(base64: string): string {
	return Buffer.from(base64, 'base64').toString('utf8').replace(/\0+$/, '').trim();
}

/** Device tree of one device: object -> instance -> resource -> value field */
export type DeviceTree = Record<string, Record<string, Record<string, ValueField | string> | string> | string>;

/**
 * Merges an event or reply payload into a device tree (partial update).
 *
 * @param target device tree
 * @param path path relative to the device, e.g. `lemonbeat/0`
 * @param payload payload of the event
 * @param overwrite replace the node at `path` instead of merging
 */
export function mergeAtPath(
	target: Record<string, unknown>,
	path: string,
	payload: Record<string, unknown>,
	overwrite = false,
): void {
	const segments = path.split('/').filter(s => s.length);
	let node = target;
	for (let i = 0; i < segments.length; i++) {
		const key = segments[i];
		if (i === segments.length - 1 && overwrite) {
			node[key] = {};
		}
		if (!node[key] || typeof node[key] !== 'object') {
			node[key] = {};
		}
		node = node[key] as Record<string, unknown>;
	}
	deepMerge(node, payload);
}

/**
 * Deletes the node at `path` of a device tree.
 *
 * @param target device tree
 * @param path path relative to the device
 */
export function deleteAtPath(target: Record<string, unknown>, path: string): void {
	const segments = path.split('/').filter(s => s.length);
	let node: Record<string, unknown> | undefined = target;
	for (let i = 0; i < segments.length - 1 && node; i++) {
		node = node[segments[i]] as Record<string, unknown> | undefined;
	}
	if (node && segments.length) {
		delete node[segments[segments.length - 1]];
	}
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(source)) {
		const existing = target[key];
		if (
			value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			!isValueField(value) &&
			existing &&
			typeof existing === 'object' &&
			!Array.isArray(existing)
		) {
			deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
		} else {
			target[key] = value;
		}
	}
}

/**
 * Reads a value field from a device tree.
 *
 * @param tree device tree
 * @param object object name, e.g. `lemonbeat`
 * @param instance instance id, e.g. `0`
 * @param resource resource name, e.g. `battery_level`
 */
export function getField(
	tree: Record<string, unknown> | undefined,
	object: string,
	instance: string,
	resource: string,
): ValueField | undefined {
	const obj = tree?.[object] as Record<string, unknown> | undefined;
	const inst = obj?.[instance] as Record<string, unknown> | undefined;
	const field = inst?.[resource];
	return isValueField(field) ? field : undefined;
}

/**
 * Returns the instance ids of a (multi instance) object, e.g. the valves of a Gen2 device.
 *
 * @param tree device tree
 * @param object object name
 */
export function instanceIds(tree: Record<string, unknown> | undefined, object: string): string[] {
	const obj = tree?.[object];
	if (!obj || typeof obj !== 'object') {
		return [];
	}
	return Object.keys(obj).filter(k => k !== '_urn' && /^\d+$/.test(k));
}
