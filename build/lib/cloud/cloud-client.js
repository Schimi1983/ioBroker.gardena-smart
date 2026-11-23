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
var cloud_client_exports = {};
__export(cloud_client_exports, {
  API_URL: () => API_URL,
  AUTH_URL: () => AUTH_URL,
  CloudAuthError: () => CloudAuthError,
  CloudClient: () => CloudClient,
  CloudQuotaError: () => CloudQuotaError,
  retryAfter: () => retryAfter
});
module.exports = __toCommonJS(cloud_client_exports);
const AUTH_URL = "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token";
const API_URL = "https://api.smart.gardena.dev/v2";
const TIMEOUT_MS = 2e4;
class CloudAuthError extends Error {
}
class CloudQuotaError extends Error {
  /**
   * @param message error text
   * @param retryAfterMs waiting time requested by the cloud (ms), if given
   */
  constructor(message, retryAfterMs) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}
class CloudClient {
  /**
   * @param options client options
   */
  constructor(options) {
    this.options = options;
    var _a, _b;
    this.fetchFn = (_a = options.fetchFn) != null ? _a : fetch;
    this.now = (_b = options.now) != null ? _b : Date.now;
  }
  token;
  tokenValidUntil = 0;
  fetchFn;
  now;
  /**
   * Reads all devices of all locations: 1 request for the list of locations plus 1 per location.
   *
   * @returns devices with their names from the GARDENA app
   */
  async listDevices() {
    var _a, _b, _c, _d, _e, _f;
    const locations = await this.get("/locations");
    const result = [];
    for (const loc of (_a = locations.data) != null ? _a : []) {
      if (!(loc == null ? void 0 : loc.id)) {
        continue;
      }
      const detail = await this.get(`/locations/${encodeURIComponent(loc.id)}`);
      const locationName = (_d = (_c = (_b = detail.data) == null ? void 0 : _b.attributes) == null ? void 0 : _c.name) != null ? _d : "";
      for (const item of (_e = detail.included) != null ? _e : []) {
        if ((item == null ? void 0 : item.type) !== "COMMON" || !item.id) {
          continue;
        }
        const attr = (_f = item.attributes) != null ? _f : {};
        const text = (key) => {
          var _a2;
          const value = (_a2 = attr[key]) == null ? void 0 : _a2.value;
          return typeof value === "string" ? value.trim() : "";
        };
        result.push({
          id: item.id,
          name: text("name"),
          serial: text("serial"),
          model: text("modelType"),
          location: locationName
        });
      }
    }
    return result;
  }
  /** Forgets the token (e.g. after changing the App Key). */
  clearToken() {
    this.token = void 0;
    this.tokenValidUntil = 0;
  }
  async get(path) {
    var _a, _b;
    if (!this.options.quota.allows(1)) {
      throw new CloudQuotaError("Weekly limit of the GARDENA cloud reached (counted by the adapter)", null);
    }
    const token = await this.getToken();
    this.options.quota.add();
    (_b = (_a = this.options).onRequest) == null ? void 0 : _b.call(_a);
    const res = await this.request(`${API_URL}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Api-Key": this.options.appKey,
        "Authorization-Provider": "husqvarna",
        Accept: "application/vnd.api+json"
      }
    });
    if (res.status === 429) {
      throw new CloudQuotaError("The GARDENA cloud reports: too many requests", retryAfter(res));
    }
    if (res.status === 401) {
      this.clearToken();
      throw new Error("The GARDENA cloud did not accept the access token (HTTP 401)");
    }
    if (res.status === 403) {
      throw new CloudAuthError(
        'Access denied (HTTP 403). Is the "GARDENA smart system API" connected to your application in the Developer Portal?'
      );
    }
    if (!res.ok) {
      throw new Error(`GARDENA cloud answered with HTTP ${res.status}`);
    }
    return res.json();
  }
  async getToken() {
    if (this.token && this.now() < this.tokenValidUntil) {
      return this.token;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.appKey,
      client_secret: this.options.appSecret
    });
    const res = await this.request(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new CloudAuthError("App Key or App Secret were not accepted. Please check them in the settings.");
    }
    if (res.status === 429) {
      throw new CloudQuotaError("The Husqvarna login reports: too many requests", retryAfter(res));
    }
    if (!res.ok) {
      throw new Error(`Husqvarna login answered with HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.access_token) {
      throw new Error("Husqvarna login returned no access token");
    }
    const lifetime = Math.max(60, Number(json.expires_in) || 3600);
    this.token = json.access_token;
    this.tokenValidUntil = this.now() + (lifetime - 300) * 1e3;
    return this.token;
  }
  async request(url, init) {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`GARDENA cloud not reachable: ${err.message}`);
    }
  }
}
function retryAfter(res) {
  const value = res.headers.get("retry-after");
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1e3);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  API_URL,
  AUTH_URL,
  CloudAuthError,
  CloudClient,
  CloudQuotaError,
  retryAfter
});
//# sourceMappingURL=cloud-client.js.map
