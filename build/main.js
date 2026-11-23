"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_cloud_client = require("./lib/cloud/cloud-client");
var import_quota = require("./lib/cloud/quota");
var import_device_manager = require("./lib/devices/device-manager");
var import_gateway_client = require("./lib/local/gateway-client");
const COMMAND_PATTERNS = [
  "devices.*.open",
  "devices.*.duration",
  "devices.*.buttonTime",
  "devices.*.identify",
  "devices.*.closeAll",
  "devices.*.measure",
  "devices.*.on",
  "devices.*.start",
  "devices.*.parkUntilNextTask",
  "devices.*.parkUntilFurtherNotice",
  "devices.*.pause",
  "devices.*.operatingMode",
  "info.trustNewCertificate",
  "cloud.refresh",
  "cloud.quota.reset"
];
const CLOUD_REFRESH_MS = 24 * 60 * 60 * 1e3;
const CLOUD_BLOCK_DEFAULT_MS = 60 * 60 * 1e3;
class GardenaSmart extends utils.Adapter {
  client;
  devices;
  rediscoverTimer;
  discovering = false;
  cloud;
  quota = new import_quota.QuotaCounter();
  cloudNames;
  cloudTimer;
  quotaTimer;
  cloudBlockedUntil = 0;
  cloudStarted = false;
  constructor(options = {}) {
    super({
      ...options,
      name: "gardena-smart"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    var _a;
    await this.setState("info.connection", false, true);
    const host = ((_a = this.config.host) != null ? _a : "").trim();
    const port = Number(this.config.port) || 8443;
    if (!host || !this.config.password) {
      this.log.error(
        "Please enter the address and the password of your GARDENA smart Gateway in the adapter settings."
      );
      return;
    }
    for (const pattern of COMMAND_PATTERNS) {
      this.subscribeStates(pattern);
    }
    await this.initCloud();
    this.startClient(host, port);
  }
  /**
   * Creates the gateway connection. A stored certificate is pinned, otherwise it is trusted on first use.
   *
   * @param host address of the gateway
   * @param port port of the local API
   */
  startClient(host, port) {
    void (async () => {
      var _a;
      const stored = await this.getStateAsync("info.certificate");
      const certificatePem = typeof (stored == null ? void 0 : stored.val) === "string" && stored.val.includes("BEGIN CERTIFICATE") ? stored.val : void 0;
      const timers = {
        setTimeout: (cb, ms) => this.setTimeout(cb, ms),
        clearTimeout: (h) => this.clearTimeout(h),
        setInterval: (cb, ms) => this.setInterval(cb, ms),
        clearInterval: (h) => this.clearInterval(h)
      };
      const client = new import_gateway_client.GatewayClient({
        host,
        port,
        password: this.config.password,
        certificatePem,
        log: this.log,
        timers
      });
      this.client = client;
      this.devices = new import_device_manager.DeviceManager(this, client, !!this.config.rawStates);
      client.on("certificate", (cert) => void this.storeCertificate(cert));
      client.on("connected", () => void this.onConnected());
      client.on("disconnected", () => void this.setState("info.connection", false, true));
      client.on("authFailed", () => void this.setState("info.connection", false, true));
      client.on("certificateMismatch", () => void this.setState("info.connection", false, true));
      client.on("event", (event) => void this.onGatewayEvent(event));
      if (certificatePem) {
        const fp = await this.getStateAsync("info.certificateFingerprint");
        this.log.debug(`Using pinned gateway certificate ${String((_a = fp == null ? void 0 : fp.val) != null ? _a : "")}`);
      }
      client.start();
    })();
  }
  async storeCertificate(cert) {
    await this.setState("info.certificate", cert.pem, true);
    await this.setState("info.certificateFingerprint", cert.fingerprint, true);
    if (cert.hostname) {
      await this.setState("info.gateway", cert.hostname, true);
    }
  }
  async onConnected() {
    await this.setState("info.connection", true, true);
    await this.discover();
  }
  /** Reads all devices from the gateway and updates the objects. */
  async discover() {
    if (!this.client || !this.devices || this.discovering) {
      return;
    }
    this.discovering = true;
    try {
      const found = await this.client.discover();
      await this.devices.sync(found);
      await this.setState("info.devices", this.devices.count, true);
      this.log.info(`${found.size} GARDENA device(s) found`);
      if (this.cloudNames) {
        await this.devices.applyNames(this.cloudNames);
      } else if (this.cloud && !this.cloudStarted) {
        this.cloudStarted = true;
        void this.refreshCloud();
      }
    } catch (err) {
      this.log.warn(`Reading the devices failed: ${err.message}`);
    } finally {
      this.discovering = false;
    }
  }
  async onGatewayEvent(event) {
    if (!this.devices) {
      return;
    }
    try {
      const known = await this.devices.applyEvent(event);
      if (!known && !this.rediscoverTimer) {
        this.rediscoverTimer = this.setTimeout(() => {
          this.rediscoverTimer = void 0;
          void this.discover();
        }, 5e3);
      }
    } catch (err) {
      this.log.warn(`Processing a gateway message failed: ${err.message}`);
    }
  }
  async onStateChange(id, state) {
    var _a, _b, _c, _d;
    if (!state || state.ack) {
      return;
    }
    if (id === `${this.namespace}.info.trustNewCertificate`) {
      this.log.info("Trusting the next certificate the gateway presents");
      (_a = this.client) == null ? void 0 : _a.stop();
      await this.setState("info.certificate", "", true);
      await this.setState("info.certificateFingerprint", "", true);
      this.startClient(((_b = this.config.host) != null ? _b : "").trim(), Number(this.config.port) || 8443);
      return;
    }
    if (id === `${this.namespace}.cloud.refresh`) {
      await this.refreshCloud();
      return;
    }
    if (id === `${this.namespace}.cloud.quota.reset`) {
      this.log.info("Request counter of the GARDENA cloud reset");
      this.quota.reset();
      this.cloudBlockedUntil = 0;
      await this.saveQuota();
      return;
    }
    if (!((_c = this.client) == null ? void 0 : _c.connected)) {
      this.log.warn("Command not possible: no connection to the GARDENA smart Gateway");
      return;
    }
    await ((_d = this.devices) == null ? void 0 : _d.handleCommand(id, state));
  }
  /** Prepares the optional cloud connection (only if App Key and App Secret are entered). */
  async initCloud() {
    var _a, _b;
    const appKey = ((_a = this.config.appKey) != null ? _a : "").trim();
    const appSecret = ((_b = this.config.appSecret) != null ? _b : "").trim();
    await this.setState("cloud.connection", false, true);
    const limit = Math.round(Number(this.config.cloudLimit));
    this.quota = new import_quota.QuotaCounter(Date.now, limit > 0 ? limit : import_quota.WEEKLY_LIMIT);
    const stored = await this.getStateAsync("cloud.quota.log");
    this.quota.load(stored == null ? void 0 : stored.val);
    await this.updateQuotaStates();
    this.quotaTimer = this.setInterval(() => void this.updateQuotaStates(), 60 * 60 * 1e3);
    if (!appKey || !appSecret) {
      this.log.debug("No App Key entered: the GARDENA cloud is not used");
      return;
    }
    this.cloud = new import_cloud_client.CloudClient({
      appKey,
      appSecret,
      quota: this.quota,
      onRequest: () => void this.saveQuota()
    });
    this.cloudTimer = this.setInterval(() => void this.refreshCloud(), CLOUD_REFRESH_MS);
  }
  /** Reads the device names from the GARDENA app (cloud) and takes them over. */
  async refreshCloud() {
    var _a;
    if (!this.cloud) {
      this.log.warn("Please enter App Key and App Secret in the settings to use the GARDENA cloud");
      return;
    }
    if (Date.now() < this.cloudBlockedUntil) {
      this.log.info(
        `GARDENA cloud paused until ${new Date(this.cloudBlockedUntil).toLocaleString()} (too many requests)`
      );
      return;
    }
    try {
      const list = await this.cloud.listDevices();
      const names = /* @__PURE__ */ new Map();
      for (const dev of list) {
        if (dev.serial && dev.name) {
          names.set(dev.serial, dev.name);
        }
      }
      this.cloudNames = names;
      const renamed = this.devices ? await this.devices.applyNames(names) : 0;
      await this.setState("cloud.connection", true, true);
      await this.setState("cloud.lastUpdate", Date.now(), true);
      await this.setState("cloud.blocked", false, true);
      this.log.info(`GARDENA cloud: ${list.length} device(s) in the app, ${renamed} name(s) taken over`);
    } catch (err) {
      await this.setState("cloud.connection", false, true);
      if (err instanceof import_cloud_client.CloudAuthError) {
        this.log.error(`GARDENA cloud: ${err.message}`);
      } else if (err instanceof import_cloud_client.CloudQuotaError) {
        const summary = this.quota.summary();
        const wait = (_a = err.retryAfterMs) != null ? _a : summary.remaining === 0 && summary.nextRelease ? summary.nextRelease - Date.now() : CLOUD_BLOCK_DEFAULT_MS;
        this.cloudBlockedUntil = Date.now() + Math.max(wait, 6e4);
        await this.setState("cloud.blocked", true, true);
        await this.setState("cloud.blockedUntil", this.cloudBlockedUntil, true);
        this.log.warn(
          `GARDENA cloud: ${err.message}. Next try after ${new Date(this.cloudBlockedUntil).toLocaleString()}`
        );
      } else {
        this.log.warn(`GARDENA cloud: ${err.message}`);
      }
    }
  }
  async saveQuota() {
    await this.setState("cloud.quota.log", this.quota.serialize(), true);
    await this.updateQuotaStates();
  }
  async updateQuotaStates() {
    const q = this.quota.summary();
    await this.setStateChangedAsync("cloud.quota.used", q.used, true);
    await this.setStateChangedAsync("cloud.quota.limit", q.limit, true);
    await this.setStateChangedAsync("cloud.quota.remaining", q.remaining, true);
    await this.setStateChangedAsync("cloud.quota.percent", q.percent, true);
    await this.setStateChangedAsync("cloud.quota.warning", q.warning, true);
    if (this.cloudBlockedUntil && Date.now() >= this.cloudBlockedUntil) {
      this.cloudBlockedUntil = 0;
      await this.setStateChangedAsync("cloud.blocked", false, true);
    }
  }
  onUnload(callback) {
    var _a;
    try {
      (_a = this.client) == null ? void 0 : _a.stop();
      if (this.cloudTimer) {
        this.clearInterval(this.cloudTimer);
      }
      if (this.quotaTimer) {
        this.clearInterval(this.quotaTimer);
      }
      void this.setState("info.connection", false, true);
      callback();
    } catch {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new GardenaSmart(options);
} else {
  (() => new GardenaSmart())();
}
//# sourceMappingURL=main.js.map
