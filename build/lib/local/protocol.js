"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var protocol_exports = {};
__export(protocol_exports, {
  decodeIntArray: () => decodeIntArray,
  decodeOpaqueText: () => decodeOpaqueText,
  decodeStringArray: () => decodeStringArray,
  deleteAtPath: () => deleteAtPath,
  encodeStringArray: () => encodeStringArray,
  fieldValue: () => fieldValue,
  getField: () => getField,
  instanceIds: () => instanceIds,
  isEvent: () => isEvent,
  isReply: () => isReply,
  isValueField: () => isValueField,
  mergeAtPath: () => mergeAtPath,
  parseFrame: () => parseFrame
});
module.exports = __toCommonJS(protocol_exports);
function isReply(msg) {
  return typeof msg.request_id === "string" && "success" in msg;
}
function isEvent(msg) {
  const op = msg.op;
  return op === "update" || op === "overwrite" || op === "delete";
}
function parseFrame(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(
    (m) => !!m && typeof m === "object" && !Array.isArray(m) && ("entity" in m || "request_id" in m)
  );
}
function isValueField(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  return ["vb", "vs", "vi", "vf", "vo", "vt", "ai", "as"].some((k) => k in obj);
}
function fieldValue(field) {
  if (!field) {
    return null;
  }
  if (field.vb !== void 0) {
    return field.vb;
  }
  if (field.vi !== void 0) {
    return field.vi;
  }
  if (field.vf !== void 0) {
    return field.vf;
  }
  if (field.vt !== void 0) {
    return field.vt;
  }
  if (field.vs !== void 0) {
    return field.vs;
  }
  if (field.vo !== void 0) {
    return field.vo;
  }
  if (field.ai !== void 0) {
    return decodeIntArray(field.ai).join(",");
  }
  if (field.as !== void 0) {
    return decodeStringArray(field.as).join(",");
  }
  return null;
}
function decodeIntArray(value) {
  if (value.length === 1 && typeof value[0] === "string") {
    return [...value[0].matchAll(/\d+=(-?\d+)/g)].map((m) => Number(m[1]));
  }
  return value.map((v) => Number(v));
}
function decodeStringArray(value) {
  if (value.length === 1) {
    const matches = [...value[0].matchAll(/\d+='(.*?)'(?:,|$)/g)].map((m) => m[1]);
    if (matches.length) {
      return matches;
    }
  }
  return value;
}
function encodeStringArray(values) {
  return [values.map((v, i) => `${i}='${v}'`).join(",")];
}
function decodeOpaqueText(base64) {
  return Buffer.from(base64, "base64").toString("utf8").replace(/\0+$/, "").trim();
}
function mergeAtPath(target, path, payload, overwrite = false) {
  const segments = path.split("/").filter((s) => s.length);
  let node = target;
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i];
    if (i === segments.length - 1 && overwrite) {
      node[key] = {};
    }
    if (!node[key] || typeof node[key] !== "object") {
      node[key] = {};
    }
    node = node[key];
  }
  deepMerge(node, payload);
}
function deleteAtPath(target, path) {
  const segments = path.split("/").filter((s) => s.length);
  let node = target;
  for (let i = 0; i < segments.length - 1 && node; i++) {
    node = node[segments[i]];
  }
  if (node && segments.length) {
    delete node[segments[segments.length - 1]];
  }
}
function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (value && typeof value === "object" && !Array.isArray(value) && !isValueField(value) && existing && typeof existing === "object" && !Array.isArray(existing)) {
      deepMerge(existing, value);
    } else {
      target[key] = value;
    }
  }
}
function getField(tree, object, instance, resource) {
  const obj = tree == null ? void 0 : tree[object];
  const inst = obj == null ? void 0 : obj[instance];
  const field = inst == null ? void 0 : inst[resource];
  return isValueField(field) ? field : void 0;
}
function instanceIds(tree, object) {
  const obj = tree == null ? void 0 : tree[object];
  if (!obj || typeof obj !== "object") {
    return [];
  }
  return Object.keys(obj).filter((k) => k !== "_urn" && /^\d+$/.test(k));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decodeIntArray,
  decodeOpaqueText,
  decodeStringArray,
  deleteAtPath,
  encodeStringArray,
  fieldValue,
  getField,
  instanceIds,
  isEvent,
  isReply,
  isValueField,
  mergeAtPath,
  parseFrame
});
//# sourceMappingURL=protocol.js.map
