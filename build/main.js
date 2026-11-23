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
  "info.trustNewCertificate"
];
class GardenaSmart extends utils.Adapter {
  client;
  devices;
  rediscoverTimer;
  discovering = false;
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
    if (!((_c = this.client) == null ? void 0 : _c.connected)) {
      this.log.warn("Command not possible: no connection to the GARDENA smart Gateway");
      return;
    }
    await ((_d = this.devices) == null ? void 0 : _d.handleCommand(id, state));
  }
  onUnload(callback) {
    var _a;
    try {
      (_a = this.client) == null ? void 0 : _a.stop();
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
