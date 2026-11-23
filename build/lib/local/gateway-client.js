"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var gateway_client_exports = {};
__export(gateway_client_exports, {
  CertificateMismatchError: () => CertificateMismatchError,
  GatewayClient: () => GatewayClient,
  RequestError: () => RequestError,
  describeCertificate: () => describeCertificate,
  fetchCertificate: () => fetchCertificate
});
module.exports = __toCommonJS(gateway_client_exports);
var import_node_crypto = require("node:crypto");
var import_node_events = require("node:events");
var import_node_net = require("node:net");
var tls = __toESM(require("node:tls"));
var import_ws = __toESM(require("ws"));
var import_protocol = require("./protocol");
class RequestError extends Error {
}
class CertificateMismatchError extends Error {
}
const REQUEST_TIMEOUT = 1e4;
const PING_INTERVAL = 3e4;
const RECONNECT_MIN = 5e3;
const RECONNECT_MAX = 6e4;
const RECONNECT_AUTH_FAILED = 6e5;
function derToPem(der) {
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN CERTIFICATE-----
${b64}
-----END CERTIFICATE-----
`;
}
function fetchCertificate(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: false,
      servername: (0, import_node_net.isIP)(host) ? void 0 : host,
      timeout: 1e4
    });
    socket.once("secureConnect", () => {
      const peer = socket.getPeerCertificate(false);
      socket.end();
      if (!(peer == null ? void 0 : peer.raw)) {
        reject(new Error("Gateway did not present a certificate"));
        return;
      }
      resolve(describeCertificate(derToPem(peer.raw)));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timeout while connecting to ${host}:${port}`));
    });
    socket.once("error", reject);
  });
}
function describeCertificate(pem) {
  var _a;
  const x509 = new import_node_crypto.X509Certificate(pem);
  const local = ((_a = x509.subjectAltName) != null ? _a : "").split(",").map((s) => s.trim()).find((s) => s.startsWith("DNS:") && s.endsWith(".local"));
  return {
    pem,
    fingerprint: x509.fingerprint256,
    hostname: local ? local.slice(4, -".local".length) : void 0
  };
}
class GatewayClient extends import_node_events.EventEmitter {
  /**
   * @param options connection options
   */
  constructor(options) {
    super();
    this.options = options;
    if (options.certificatePem) {
      this.certificate = describeCertificate(options.certificatePem);
    }
  }
  ws = null;
  certificate;
  pending = /* @__PURE__ */ new Map();
  reconnectTimer;
  pingTimer;
  reconnectDelay = RECONNECT_MIN;
  alive = false;
  stopped = true;
  outageLogged = false;
  /** True while the WebSocket is open. */
  get connected() {
    var _a;
    return ((_a = this.ws) == null ? void 0 : _a.readyState) === import_ws.default.OPEN;
  }
  /** Starts the connection; reconnects automatically until `stop()` is called. */
  start() {
    this.stopped = false;
    void this.connect();
  }
  /** Closes the connection and stops reconnecting. Pending requests fail. */
  stop() {
    this.stopped = true;
    this.options.timers.clearTimeout(this.reconnectTimer);
    this.closeSocket();
  }
  /**
   * Sends requests and waits for all replies.
   *
   * @param requests requests without request id
   * @param timeout timeout in ms
   */
  async request(requests, timeout = REQUEST_TIMEOUT) {
    var _a, _b, _c, _d;
    const ws = this.ws;
    if (!ws || ws.readyState !== import_ws.default.OPEN) {
      throw new Error("Not connected to the GARDENA smart Gateway");
    }
    const full = requests.map((r) => ({ ...r, request_id: (0, import_node_crypto.randomUUID)() }));
    const promises = full.map(
      (r) => new Promise((resolve, reject) => {
        const timer = this.options.timers.setTimeout(() => {
          this.pending.delete(r.request_id);
          reject(new Error(`Gateway did not answer within ${timeout / 1e3} s`));
        }, timeout);
        this.pending.set(r.request_id, { resolve, reject, timer });
      })
    );
    ws.send(JSON.stringify(full));
    const replies = await Promise.all(promises);
    const failed = replies.find((r) => !r.success);
    if (failed) {
      const reason = (_d = (_c = (_a = failed.payload) == null ? void 0 : _a.vs) != null ? _c : (_b = failed.metadata) == null ? void 0 : _b.error_source) != null ? _d : "unknown reason";
      throw new RequestError(`Gateway rejected the request: ${reason}`);
    }
    return replies;
  }
  /**
   * Writes a value.
   *
   * @param service gateway service of the device
   * @param device device id
   * @param path resource path, e.g. `lemonbeat/0/watering_timer_1`
   * @param payload value field
   */
  async write(service, device, path, payload) {
    await this.request([{ op: "write", entity: { service, device, path }, payload }]);
  }
  /**
   * Executes a resource (Gen2 commands like `actuator/0/start`).
   *
   * @param service gateway service of the device
   * @param device device id
   * @param path resource path
   * @param payload optional arguments
   */
  async execute(service, device, path, payload) {
    await this.request([{ op: "execute", entity: { service, device, path }, ...payload ? { payload } : {} }]);
  }
  /**
   * Reads all devices of both services (Gen1 and Gen2).
   * A service that fails (e.g. not available on old firmware) is skipped.
   *
   * @returns map of device id -> { service, tree }
   */
  async discover() {
    var _a;
    const result = /* @__PURE__ */ new Map();
    for (const service of ["lemonbeatd", "lwm2mserver"]) {
      try {
        const [reply] = await this.request([{ op: "read", entity: { service, path: "devices" } }], 3e4);
        for (const [id, tree] of Object.entries((_a = reply.payload) != null ? _a : {})) {
          if (tree && typeof tree === "object") {
            result.set(id, { service, tree });
          }
        }
      } catch (err) {
        this.options.log.debug(`Discovery of ${service} failed: ${err.message}`);
      }
    }
    return result;
  }
  async connect() {
    var _a;
    if (this.stopped) {
      return;
    }
    const { host, port, log } = this.options;
    try {
      if (!this.certificate) {
        const cert = await fetchCertificate(host, port);
        this.certificate = cert;
        log.info(`Trusting certificate of the gateway ${(_a = cert.hostname) != null ? _a : host} (SHA-256 ${cert.fingerprint})`);
        this.emit("certificate", cert);
      }
    } catch (err) {
      this.handleConnectError(err);
      return;
    }
    const trusted = this.certificate;
    const auth = Buffer.from(`_:${this.options.password}`).toString("base64");
    const tlsOptions = {
      ca: [trusted.pem],
      servername: (0, import_node_net.isIP)(host) ? void 0 : host,
      checkServerIdentity: (_host, cert) => cert.fingerprint256 === trusted.fingerprint ? void 0 : new CertificateMismatchError("Certificate mismatch")
    };
    const ws = new import_ws.default(`wss://${host}:${port}`, {
      ...tlsOptions,
      headers: { Authorization: `Basic ${auth}` },
      handshakeTimeout: 15e3
    });
    this.ws = ws;
    ws.on("open", () => {
      this.reconnectDelay = RECONNECT_MIN;
      this.alive = true;
      if (this.outageLogged) {
        log.info(`Reconnected to the GARDENA smart Gateway at ${host}`);
        this.outageLogged = false;
      } else {
        log.info(`Connected to the GARDENA smart Gateway at ${host}`);
      }
      this.startPing(ws);
      this.emit("connected");
    });
    ws.on("message", (data) => this.onMessage(data.toString("utf8")));
    ws.on("pong", () => {
      this.alive = true;
    });
    ws.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401) {
        log.error(
          "The GARDENA smart Gateway rejected the password. Please check the password in the adapter settings."
        );
        this.emit("authFailed");
        this.reconnectDelay = RECONNECT_AUTH_FAILED;
      } else {
        log.warn(
          `Gateway answered with HTTP ${res.statusCode}. Is the "local API" enabled in the gateway settings?`
        );
      }
      ws.terminate();
    });
    ws.on("error", (err) => this.handleConnectError(err));
    ws.on("close", () => {
      const wasOpen = this.alive;
      this.stopPing();
      if (this.ws === ws) {
        this.ws = null;
      }
      this.failPending(new Error("Connection to the gateway closed"));
      if (wasOpen) {
        this.alive = false;
        this.emit("disconnected");
      }
      this.scheduleReconnect();
    });
  }
  handleConnectError(err) {
    var _a;
    const { log, host } = this.options;
    const mismatch = err instanceof CertificateMismatchError || /certificate|self.signed|CERT_/i.test(`${err.message} ${(_a = err.code) != null ? _a : ""}`);
    if (mismatch && this.certificate) {
      log.error(
        `The gateway at ${host} presents another certificate than the trusted one (gateway reset or replaced?). Connection stopped for security reasons. Press "Trust new gateway certificate" (info.trustNewCertificate) to accept it.`
      );
      this.emit("certificateMismatch", this.certificate);
      this.stopped = true;
      this.closeSocket();
      return;
    }
    if (!this.outageLogged) {
      log.warn(`Connection to the GARDENA smart Gateway at ${host} failed: ${err.message}`);
      this.outageLogged = true;
    } else {
      log.debug(`Reconnect failed: ${err.message}`);
    }
    if (!this.ws) {
      this.scheduleReconnect();
    }
  }
  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    this.options.timers.clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, Math.max(RECONNECT_MAX, delay));
    this.reconnectTimer = this.options.timers.setTimeout(() => void this.connect(), delay);
  }
  startPing(ws) {
    this.stopPing();
    this.pingTimer = this.options.timers.setInterval(() => {
      if (!this.alive) {
        this.options.log.warn("Gateway does not answer anymore, reconnecting");
        ws.terminate();
        return;
      }
      this.alive = false;
      ws.ping();
    }, PING_INTERVAL);
  }
  stopPing() {
    this.options.timers.clearInterval(this.pingTimer);
    this.pingTimer = void 0;
  }
  closeSocket() {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners();
      ws.on("error", () => void 0);
      ws.terminate();
    }
    this.failPending(new Error("Connection closed"));
  }
  failPending(err) {
    for (const [id, p] of this.pending) {
      this.options.timers.clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
  onMessage(raw) {
    for (const msg of (0, import_protocol.parseFrame)(raw)) {
      if ((0, import_protocol.isReply)(msg)) {
        const p = this.pending.get(msg.request_id);
        if (p) {
          this.options.timers.clearTimeout(p.timer);
          this.pending.delete(msg.request_id);
          p.resolve(msg);
        }
        continue;
      }
      if ((0, import_protocol.isEvent)(msg)) {
        this.emit("event", msg);
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CertificateMismatchError,
  GatewayClient,
  RequestError,
  describeCertificate,
  fetchCertificate
});
//# sourceMappingURL=gateway-client.js.map
