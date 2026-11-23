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
var quota_exports = {};
__export(quota_exports, {
  COMMAND_RESERVE_PERCENT: () => COMMAND_RESERVE_PERCENT,
  QuotaCounter: () => QuotaCounter,
  WARNING_PERCENT: () => WARNING_PERCENT,
  WEEKLY_LIMIT: () => WEEKLY_LIMIT,
  WINDOW_MS: () => WINDOW_MS
});
module.exports = __toCommonJS(quota_exports);
const WEEKLY_LIMIT = 1e3;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
const WARNING_PERCENT = 80;
const COMMAND_RESERVE_PERCENT = 10;
class QuotaCounter {
  /**
   * @param now clock (injectable for tests)
   * @param limit weekly limit of the App Key
   */
  constructor(now = Date.now, limit = WEEKLY_LIMIT) {
    this.now = now;
    this.limit = limit;
  }
  stamps = [];
  /**
   * Restores the counter from a stored list of time stamps (invalid entries are ignored).
   *
   * @param stored JSON text of a number array
   */
  load(stored) {
    let list = [];
    if (typeof stored === "string" && stored) {
      try {
        list = JSON.parse(stored);
      } catch {
        list = [];
      }
    }
    this.stamps = Array.isArray(list) ? list.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b) : [];
    this.prune();
  }
  /** Time stamps as JSON text for storing */
  serialize() {
    this.prune();
    return JSON.stringify(this.stamps);
  }
  /** Counts one request now. */
  add() {
    this.stamps.push(this.now());
    this.prune();
  }
  /** Forgets all counted requests (e.g. after creating a new App Key). */
  reset() {
    this.stamps = [];
  }
  /**
   * Checks whether a number of further requests fits into the limit.
   *
   * @param count requests that are about to be sent
   * @param reserve requests that must stay free for commands
   */
  allows(count, reserve = 0) {
    return this.summary().remaining - reserve >= count;
  }
  /**
   * Checks whether a request of the given priority may be sent now.
   *
   * @param priority importance of the request
   * @returns true if the request fits into the limit (background requests keep the reserve free)
   */
  allowsPriority(priority) {
    const reserve = priority === "background" ? Math.ceil(this.limit * COMMAND_RESERVE_PERCENT / 100) : 0;
    return this.allows(1, reserve);
  }
  /** Current summary */
  summary() {
    this.prune();
    const used = this.stamps.length;
    const remaining = Math.max(0, this.limit - used);
    const percent = Math.min(100, Math.round(used / this.limit * 100));
    return {
      used,
      limit: this.limit,
      remaining,
      percent,
      warning: percent >= WARNING_PERCENT,
      nextRelease: used ? this.stamps[0] + WINDOW_MS : null
    };
  }
  prune() {
    const limit = this.now() - WINDOW_MS;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] <= limit) {
      i++;
    }
    if (i) {
      this.stamps.splice(0, i);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMMAND_RESERVE_PERCENT,
  QuotaCounter,
  WARNING_PERCENT,
  WEEKLY_LIMIT,
  WINDOW_MS
});
//# sourceMappingURL=quota.js.map
