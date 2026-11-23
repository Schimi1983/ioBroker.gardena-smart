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
var device_manager_exports = {};
__export(device_manager_exports, {
  DEVICES_FOLDER: () => DEVICES_FOLDER,
  DeviceManager: () => DeviceManager
});
module.exports = __toCommonJS(device_manager_exports);
var import_protocol = require("../local/protocol");
var import_models = require("./models");
var import_states = require("./states");
const DEVICES_FOLDER = "devices";
const MAX_SECONDS = 36e3;
class DeviceManager {
  /**
   * @param adapter adapter instance
   * @param client connection to the gateway
   * @param rawStates also create states for all raw values (expert option)
   */
  constructor(adapter, client, rawStates) {
    this.adapter = adapter;
    this.client = client;
    this.rawStates = rawStates;
  }
  devices = /* @__PURE__ */ new Map();
  /** ids of objects already created/updated in this adapter run */
  knownObjects = /* @__PURE__ */ new Set();
  /** Number of known devices */
  get count() {
    return this.devices.size;
  }
  /**
   * Takes over the result of a discovery and updates all devices.
   *
   * @param discovered devices reported by the gateway
   */
  async sync(discovered) {
    var _a, _b, _c, _d, _e;
    await this.ensureObject(DEVICES_FOLDER, { type: "folder", common: { name: "Devices" }, native: {} });
    for (const [id, { service, tree }] of discovered) {
      const modelNumber = String((_d = (_c = (_b = (_a = tree == null ? void 0 : tree.device) == null ? void 0 : _a["0"]) == null ? void 0 : _b.model_number) == null ? void 0 : _c.vs) != null ? _d : "");
      const kind = (_e = import_models.MODEL_KINDS[modelNumber]) != null ? _e : "unknown";
      if (kind === "unknown") {
        this.adapter.log.info(
          `Device ${id} with model number ${modelNumber || "?"} is not supported yet, only general information is shown. Please open an issue on GitHub with the "raw" values (enable "raw values" in the settings).`
        );
      }
      const dev = { id, kind, service, tree };
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
  async applyEvent(event) {
    const deviceId = event.entity.device;
    if (!deviceId) {
      return true;
    }
    const dev = this.devices.get(deviceId);
    if (!dev) {
      return false;
    }
    if (event.op === "delete") {
      (0, import_protocol.deleteAtPath)(dev.tree, event.entity.path);
    } else if (event.payload) {
      (0, import_protocol.mergeAtPath)(dev.tree, event.entity.path, event.payload, event.op === "overwrite");
    }
    await this.updateDevice(dev, false);
    return true;
  }
  /** Sets all devices offline (e.g. connection to the gateway lost). */
  async setAllOffline() {
    for (const id of this.devices.keys()) {
      await this.adapter.setStateChangedAsync(`${DEVICES_FOLDER}.${id}.info.online`, false, true);
    }
  }
  async updateDevice(dev, full) {
    const base = `${DEVICES_FOLDER}.${dev.id}`;
    await this.ensureObject(base, {
      type: "device",
      common: {
        name: (0, import_states.deviceName)(dev),
        statusStates: { onlineId: `${this.adapter.namespace}.${base}.info.online` }
      },
      native: { kind: dev.kind, service: dev.service }
    });
    const { channels, states } = (0, import_states.buildDevice)(dev);
    for (const ch of channels) {
      await this.ensureObject(`${base}.${ch.id}`, { type: "channel", common: { name: ch.name }, native: {} });
    }
    const all = this.rawStates ? [...states, ...(0, import_states.buildRawStates)(dev)] : states;
    if (this.rawStates) {
      await this.ensureObject(`${base}.raw`, {
        type: "channel",
        common: { name: "Raw values (expert)" },
        native: {}
      });
    }
    for (const spec of all) {
      const id = `${base}.${spec.id}`;
      if (!this.knownObjects.has(id)) {
        await this.adapter.extendObject(id, {
          type: "state",
          common: spec.common,
          native: {}
        });
        this.knownObjects.add(id);
        if (spec.value === void 0 && spec.common.def !== void 0) {
          const existing = await this.adapter.getStateAsync(id);
          if (!existing || existing.val === null) {
            await this.adapter.setState(id, spec.common.def, true);
          }
        }
      }
      if (spec.value !== void 0 && (spec.value !== null || full)) {
        await this.adapter.setStateChangedAsync(id, {
          val: spec.value,
          ack: true,
          ...spec.ts ? { ts: spec.ts } : {}
        });
      }
    }
  }
  async ensureObject(id, obj) {
    if (this.knownObjects.has(id)) {
      return;
    }
    if (obj.type === "device") {
      await this.adapter.setObjectNotExistsAsync(id, obj);
      await this.adapter.extendObject(id, {
        native: obj.native,
        common: { statusStates: obj.common.statusStates }
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
  async handleCommand(id, state) {
    const rel = id.slice(this.adapter.namespace.length + 1);
    const parts = rel.split(".");
    if (parts[0] !== DEVICES_FOLDER || parts.length < 4) {
      return;
    }
    const dev = this.devices.get(parts[1]);
    if (!dev) {
      this.adapter.log.warn(`Unknown device ${parts[1]}`);
      return;
    }
    const channel = parts[2];
    const name = parts[3];
    const gen1 = dev.service === "lemonbeatd";
    try {
      if (channel === "info" && name === "identify") {
        if (gen1) {
          await this.gen1Command(dev, import_models.GEN1_COMMAND.identify);
        } else {
          await this.client.execute(dev.service, dev.id, "sg_common/0/identify");
        }
      } else if (channel === "closeAll") {
        if (gen1) {
          await this.gen1Command(dev, import_models.GEN1_COMMAND.closeAllValves);
        } else {
          await this.client.execute(dev.service, dev.id, "sg_common/0/stop_all_actuators", {
            as: (0, import_protocol.encodeStringArray)([import_models.GEN2_COMMAND_SOURCE])
          });
        }
      } else if (/^valve\d+$/.test(channel)) {
        await this.valveCommand(dev, Number(channel.slice(5)), name, state, id);
        return;
      } else if (channel === "sensor" && name === "measure") {
        await this.gen1Command(dev, import_models.GEN1_COMMAND.measureSoilMoisture);
        await this.gen1Command(dev, import_models.GEN1_COMMAND.measureSoilTemperature);
        if (dev.kind === "sensor1") {
          await this.gen1Command(dev, import_models.GEN1_COMMAND.measureLight);
          await this.gen1Command(dev, import_models.GEN1_COMMAND.measureAmbientTemperature);
        }
      } else if (channel === "power") {
        await this.powerCommand(dev, name, state, id);
        return;
      } else {
        return;
      }
      this.adapter.log.debug(`Command ${rel} sent`);
    } catch (err) {
      this.adapter.log.warn(`Command ${rel} failed: ${err.message}`);
    }
  }
  async valveCommand(dev, valve, name, state, id) {
    const base = id.slice(0, id.lastIndexOf("."));
    const gen1 = dev.service === "lemonbeatd";
    if (name === "duration") {
      await this.adapter.setState(id, state.val, true);
      return;
    }
    try {
      if (name === "open") {
        const open = state.val === true || state.val === "true" || state.val === 1;
        const seconds = open ? await this.durationSeconds(`${base}.duration`, 30) : 0;
        if (gen1) {
          await this.client.write(dev.service, dev.id, `lemonbeat/0/watering_timer_${valve}`, {
            vi: seconds
          });
        } else if (open) {
          await this.client.execute(dev.service, dev.id, `actuator/${valve - 1}/start`, {
            as: (0, import_protocol.encodeStringArray)([import_models.GEN2_COMMAND_SOURCE, String(seconds)])
          });
        } else {
          await this.client.execute(dev.service, dev.id, `actuator/${valve - 1}/stop`, {
            as: (0, import_protocol.encodeStringArray)([import_models.GEN2_COMMAND_SOURCE])
          });
        }
        this.adapter.log.info(
          open ? `Valve ${valve} of ${(0, import_states.deviceName)(dev)} opened for ${seconds / 60} min` : `Valve ${valve} of ${(0, import_states.deviceName)(dev)} closed`
        );
      } else if (name === "buttonTime") {
        const seconds = Math.min(MAX_SECONDS, Math.max(0, Math.round(Number(state.val) * 60)));
        if (gen1) {
          await this.client.write(dev.service, dev.id, "lemonbeat/0/button_config_time", { vi: seconds });
        } else {
          await this.client.write(dev.service, dev.id, `actuator/${valve - 1}/default_duration_seconds`, {
            vi: seconds
          });
        }
      }
    } catch (err) {
      this.adapter.log.warn(`Valve ${valve} of ${(0, import_states.deviceName)(dev)}: ${err.message}`);
      await this.restore(dev, id);
    }
  }
  async powerCommand(dev, name, state, id) {
    if (name === "duration") {
      await this.adapter.setState(id, state.val, true);
      return;
    }
    if (name !== "on") {
      return;
    }
    try {
      const on = state.val === true || state.val === "true" || state.val === 1;
      const seconds = on ? await this.durationSeconds(id.replace(/\.on$/, ".duration"), 60) : 0;
      await this.client.write(dev.service, dev.id, "lemonbeat/0/power_timer", { vi: seconds });
      this.adapter.log.info(
        on ? `${(0, import_states.deviceName)(dev)} switched on for ${seconds / 60} min` : `${(0, import_states.deviceName)(dev)} switched off`
      );
    } catch (err) {
      this.adapter.log.warn(`${(0, import_states.deviceName)(dev)}: ${err.message}`);
      await this.restore(dev, id);
    }
  }
  async durationSeconds(durationId, defaultMinutes) {
    const st = await this.adapter.getStateAsync(durationId);
    const minutes = typeof (st == null ? void 0 : st.val) === "number" && st.val > 0 ? st.val : defaultMinutes;
    return Math.min(MAX_SECONDS, Math.max(1, Math.round(minutes * 60)));
  }
  async gen1Command(dev, command) {
    await this.client.write("lemonbeatd", dev.id, "lemonbeat/0/command", { vi: command });
  }
  /**
   * Writes the actual device value back after a failed command.
   *
   * @param dev device
   * @param id full state id
   */
  async restore(dev, id) {
    const rel = id.slice(`${this.adapter.namespace}.${DEVICES_FOLDER}.${dev.id}.`.length);
    const spec = (0, import_states.buildDevice)(dev).states.find((s) => s.id === rel);
    if (spec && spec.value !== void 0) {
      await this.adapter.setState(id, { val: spec.value, ack: true });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEVICES_FOLDER,
  DeviceManager
});
//# sourceMappingURL=device-manager.js.map
