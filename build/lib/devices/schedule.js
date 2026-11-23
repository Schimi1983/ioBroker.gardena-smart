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
var schedule_exports = {};
__export(schedule_exports, {
  decodePause: () => decodePause,
  decodeSchedules: () => decodeSchedules,
  encodePause: () => encodePause,
  parseUtcOffset: () => parseUtcOffset,
  weekdayNames: () => weekdayNames
});
module.exports = __toCommonJS(schedule_exports);
const PERMANENT_YEAR = 2038;
const PERMANENT = { year: 2038, month: 1, day: 18, hour: 1, minute: 0 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekdayNames(mask) {
  return [1, 2, 3, 4, 5, 6, 0].filter((bit) => (mask & 1 << bit) !== 0).map((bit) => WEEKDAYS[bit]);
}
function parseUtcOffset(text) {
  var _a;
  const m = typeof text === "string" ? /^UTC([+-])(\d{1,2}):?(\d{2})?$/.exec(text.trim()) : null;
  if (!m) {
    return 0;
  }
  const minutes = Number(m[2]) * 60 + Number((_a = m[3]) != null ? _a : 0);
  return m[1] === "-" ? -minutes : minutes;
}
function decodePause(base64, offsetMinutes) {
  if (base64 === "") {
    return { paused: false, until: 0, permanent: false };
  }
  if (typeof base64 !== "string") {
    return null;
  }
  const b = Buffer.from(base64, "base64");
  if (b.length < 6) {
    return null;
  }
  const year = b[0] | b[1] << 8;
  const until = Date.UTC(year, b[2] - 1, b[3], b[4], b[5]) - offsetMinutes * 6e4;
  if (!Number.isFinite(until)) {
    return null;
  }
  return { paused: true, until, permanent: year >= PERMANENT_YEAR };
}
function encodePause(until, offsetMinutes) {
  if (until === 0) {
    return "";
  }
  let p;
  if (until === "permanent") {
    p = PERMANENT;
  } else {
    const local = new Date(until + offsetMinutes * 6e4);
    p = {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes()
    };
  }
  return Buffer.from([p.year & 255, p.year >> 8, p.month, p.day, p.hour, p.minute]).toString("base64");
}
function decodeSchedules(base64) {
  if (typeof base64 !== "string" || !base64) {
    return [];
  }
  const b = Buffer.from(base64, "base64");
  const list = [];
  for (let i = 0; i + 7 <= b.length; i += 7) {
    const hour = b[i + 2];
    const minute = b[i + 3];
    const minutes = b[i + 4] | b[i + 5] << 8;
    if (hour > 23 || minute > 59) {
      return [];
    }
    const endMin = (hour * 60 + minute + minutes) % 1440;
    list.push({
      id: b[i],
      days: b[i + 1],
      start: hhmm(hour * 60 + minute),
      end: hhmm(endMin),
      minutes
    });
  }
  return list;
}
function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decodePause,
  decodeSchedules,
  encodePause,
  parseUtcOffset,
  weekdayNames
});
//# sourceMappingURL=schedule.js.map
