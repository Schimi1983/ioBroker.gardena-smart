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
var states_exports = {};
__export(states_exports, {
  buildDevice: () => buildDevice,
  buildRawStates: () => buildRawStates,
  deviceName: () => deviceName,
  mowerState: () => mowerState,
  wateringEnd: () => wateringEnd
});
module.exports = __toCommonJS(states_exports);
var import_protocol = require("../local/protocol");
var import_models = require("./models");
const n = (en, de) => ({ en, de });
function v(tree, object, instance, resource) {
  const field = (0, import_protocol.getField)(tree, object, instance, resource);
  return { value: (0, import_protocol.fieldValue)(field), ts: (field == null ? void 0 : field.ts) ? field.ts * 1e3 : void 0 };
}
function num(value) {
  return typeof value === "number" ? value : null;
}
function deviceName(dev) {
  const userName = v(dev.tree, "sg_common", "0", "name").value;
  if (typeof userName === "string" && userName.trim()) {
    return userName.trim();
  }
  const type = v(dev.tree, "device", "0", "device_type").value;
  const serial = v(dev.tree, "device", "0", "serial_number").value;
  return [type || "GARDENA device", serial].filter(Boolean).join(" ");
}
function buildDevice(dev) {
  var _a, _b, _c;
  const channels = [{ id: "info", name: n("Device information", "Ger\xE4teinformationen") }];
  const states = [];
  const t = dev.tree;
  const gen1 = dev.service === "lemonbeatd";
  const online = v(t, "connection_status", "0", "online");
  states.push({
    id: "info.online",
    common: { name: n("Online", "Online"), type: "boolean", role: "indicator.reachable", read: true, write: false },
    value: typeof online.value === "boolean" ? online.value : null,
    ts: online.ts
  });
  for (const [res, id, name] of [
    ["device_type", "model", n("Model", "Modell")],
    ["serial_number", "serial", n("Serial number", "Seriennummer")],
    ["software_version", "firmware", n("Firmware version", "Firmware-Version")]
  ]) {
    states.push({
      id: `info.${id}`,
      common: { name, type: "string", role: "text", read: true, write: false },
      value: (_b = (_a = v(t, "device", "0", res).value) == null ? void 0 : _a.toString()) != null ? _b : null
    });
  }
  const battery = gen1 ? v(t, "lemonbeat", "0", "battery_level") : v(t, "device", "0", "battery_level");
  if (battery.value !== null) {
    states.push({
      id: "info.battery",
      common: {
        name: n("Battery", "Batterie"),
        type: "number",
        role: "value.battery",
        unit: "%",
        min: 0,
        max: 100,
        read: true,
        write: false
      },
      value: num(battery.value),
      ts: battery.ts
    });
  }
  if (gen1) {
    const rf = v(t, "lemonbeat", "0", "rf_link_quality");
    if (rf.value !== null) {
      states.push({
        id: "info.signal",
        common: {
          name: n("Radio signal", "Funksignal"),
          type: "number",
          role: "value",
          unit: "%",
          min: 0,
          max: 100,
          read: true,
          write: false
        },
        value: num(rf.value),
        ts: rf.ts
      });
    }
    const frost = v(t, "lemonbeat", "0", "frost_warning");
    if (frost.value !== null) {
      states.push({
        id: "info.frostWarning",
        common: {
          name: n("Frost warning", "Frostwarnung"),
          type: "boolean",
          role: "indicator.alarm",
          read: true,
          write: false
        },
        value: frost.value === 1 || frost.value === true,
        ts: frost.ts
      });
    }
  } else {
    const lq = v(t, "connectivity_monitoring", "0", "link_quality");
    if (lq.value !== null) {
      states.push({
        id: "info.signal",
        common: {
          name: n("Radio signal", "Funksignal"),
          type: "number",
          role: "value",
          unit: "%",
          min: 0,
          max: 100,
          read: true,
          write: false
        },
        value: typeof lq.value === "number" ? (_c = import_models.GEN2_LINK_QUALITY_PERCENT[lq.value]) != null ? _c : 0 : null,
        ts: lq.ts
      });
    }
    const temp = v(t, "temperature", "0", "sensor_value");
    if (typeof temp.value === "number") {
      states.push({
        id: "info.temperature",
        common: {
          name: n("Temperature", "Temperatur"),
          type: "number",
          role: "value.temperature",
          unit: "\xB0C",
          read: true,
          write: false
        },
        value: Math.round(temp.value * 10) / 10,
        ts: temp.ts
      });
      states.push({
        id: "info.frostWarning",
        common: {
          name: n("Frost warning", "Frostwarnung"),
          type: "boolean",
          role: "indicator.alarm",
          read: true,
          write: false
        },
        value: temp.value < import_models.GEN2_FROST_TEMPERATURE,
        ts: temp.ts
      });
    }
  }
  states.push({
    id: "info.identify",
    common: {
      name: n("Identify (LED flashes)", "Identifizieren (LED blinkt)"),
      type: "boolean",
      role: "button",
      read: false,
      write: true
    }
  });
  switch (dev.kind) {
    case "waterControl1":
      addAmbientTemperature(t, states);
      addGen1Valves(t, 1, channels, states, true);
      break;
    case "irrigationControl1":
      addGen1Valves(t, 6, channels, states, false);
      addCloseAll(states);
      break;
    case "waterControl2":
    case "irrigationControl2":
      addGen2Valves(t, channels, states);
      if (dev.kind === "irrigationControl2") {
        addCloseAll(states);
      }
      break;
    case "sensor1":
    case "sensor2":
      addSensor(t, dev.kind, channels, states);
      break;
    case "powerAdapter":
      addPowerAdapter(t, channels, states);
      break;
    case "mower1":
    case "mower2":
      addMowerStatus(t, dev.kind, channels, states);
      break;
    case "pump":
      addPump(t, channels, states);
      break;
    default:
      break;
  }
  return { channels, states };
}
function addAmbientTemperature(t, states) {
  const temp = v(t, "lemonbeat", "0", "ambient_temperature");
  if (temp.value !== null) {
    states.push({
      id: "info.temperature",
      common: {
        name: n("Temperature", "Temperatur"),
        type: "number",
        role: "value.temperature",
        unit: "\xB0C",
        read: true,
        write: false
      },
      value: num(temp.value),
      ts: temp.ts
    });
  }
}
function wateringEnd(seconds, ts) {
  if (seconds === null) {
    return null;
  }
  if (seconds === 0) {
    return 0;
  }
  return ts === void 0 ? null : ts + Math.abs(seconds) * 1e3;
}
function valveControls(states, ch, open, ts) {
  states.push({
    id: `${ch}.open`,
    common: {
      name: n("Open valve (true = open, false = close)", "Ventil \xF6ffnen (true = auf, false = zu)"),
      type: "boolean",
      role: "switch",
      read: true,
      write: true
    },
    value: open,
    ts
  });
  states.push({
    id: `${ch}.duration`,
    common: {
      name: n('Watering time when opened via "open"', 'Bew\xE4sserungsdauer beim \xD6ffnen \xFCber "open"'),
      type: "number",
      role: "level.timer",
      unit: "min",
      min: 1,
      max: 600,
      def: 30,
      read: true,
      write: true
    }
  });
}
function addGen1Valves(t, count, channels, states, waterControl) {
  const connected = num(v(t, "lemonbeat", "0", "valves_connected").value);
  for (let i = 1; i <= count; i++) {
    const ch = `valve${i}`;
    let name = count === 1 ? "Valve" : `Valve ${i}`;
    const opaqueName = v(t, "lemonbeat", "0", `valve_name_${i}`).value;
    if (typeof opaqueName === "string" && opaqueName) {
      const decoded = (0, import_protocol.decodeOpaqueText)(opaqueName);
      if (decoded) {
        name = decoded;
      }
    }
    channels.push({ id: ch, name });
    const timer = v(t, "lemonbeat", "0", `watering_timer_${i}`);
    const timerValue = num(timer.value);
    valveControls(states, ch, timerValue === null ? null : timerValue !== 0, timer.ts);
    states.push({
      id: `${ch}.active`,
      common: {
        name: n("Watering active", "Bew\xE4sserung l\xE4uft"),
        type: "boolean",
        role: "indicator.working",
        read: true,
        write: false
      },
      value: timerValue === null ? null : timerValue !== 0,
      ts: timer.ts
    });
    states.push({
      id: `${ch}.source`,
      common: {
        name: n("Started by", "Gestartet durch"),
        type: "string",
        role: "text",
        read: true,
        write: false,
        states: { off: "off", manual: "manual", schedule: "schedule" }
      },
      value: timerValue === null ? null : timerValue === 0 ? "off" : timerValue > 0 ? "manual" : "schedule",
      ts: timer.ts
    });
    states.push({
      id: `${ch}.endTime`,
      common: {
        name: n("Watering ends at (0 = not watering)", "Bew\xE4sserung endet um (0 = l\xE4uft nicht)"),
        type: "number",
        role: "value.time",
        read: true,
        write: false
      },
      value: wateringEnd(timerValue, timer.ts),
      ts: timer.ts
    });
    const error = v(t, "lemonbeat", "0", `valve_error_${i}`);
    states.push({
      id: `${ch}.error`,
      common: {
        name: n("Error code (0 = no error)", "Fehlercode (0 = kein Fehler)"),
        type: "number",
        role: "value",
        read: true,
        write: false
      },
      value: num(error.value),
      ts: error.ts
    });
    if (connected !== null) {
      states.push({
        id: `${ch}.connected`,
        common: {
          name: n("Valve connected", "Ventil angeschlossen"),
          type: "boolean",
          role: "indicator",
          read: true,
          write: false
        },
        value: (connected & 1 << i) !== 0
      });
    }
    if (waterControl) {
      const button2 = v(t, "lemonbeat", "0", "button_config_time");
      if (button2.value !== null) {
        states.push({
          id: `${ch}.buttonTime`,
          common: {
            name: n(
              "Watering time when the button on the device is pressed",
              "Bew\xE4sserungsdauer bei Tastendruck am Ger\xE4t"
            ),
            type: "number",
            role: "level.timer",
            unit: "min",
            min: 0,
            max: 600,
            read: true,
            write: true
          },
          value: typeof button2.value === "number" ? Math.round(button2.value / 60) : null,
          ts: button2.ts
        });
      }
    }
  }
}
function addGen2Valves(t, channels, states) {
  const ids = (0, import_protocol.instanceIds)(t, "actuator");
  const single = ids.length === 1;
  for (const id of ids) {
    const nr = Number(id) + 1;
    const ch = `valve${nr}`;
    const userName = v(t, "actuator", id, "name").value;
    channels.push({
      id: ch,
      name: typeof userName === "string" && userName.trim() ? userName.trim() : single ? "Valve" : `Valve ${nr}`
    });
    const state = v(t, "actuator", id, "state");
    const stateNr = num(state.value);
    const active = stateNr === null ? null : stateNr === 1 || stateNr === 2;
    valveControls(states, ch, active, state.ts);
    states.push({
      id: `${ch}.active`,
      common: {
        name: n("Watering active", "Bew\xE4sserung l\xE4uft"),
        type: "boolean",
        role: "indicator.working",
        read: true,
        write: false
      },
      value: active,
      ts: state.ts
    });
    states.push({
      id: `${ch}.state`,
      common: {
        name: n("Valve state", "Ventilzustand"),
        type: "number",
        role: "value",
        read: true,
        write: false,
        states: import_models.GEN2_ACTUATOR_STATES
      },
      value: stateNr,
      ts: state.ts
    });
    const available = v(t, "actuator", id, "available");
    if (available.value !== null) {
      states.push({
        id: `${ch}.connected`,
        common: {
          name: n("Valve connected", "Ventil angeschlossen"),
          type: "boolean",
          role: "indicator",
          read: true,
          write: false
        },
        value: available.value === true,
        ts: available.ts
      });
    }
    const error = v(t, "actuator", id, "error");
    states.push({
      id: `${ch}.error`,
      common: {
        name: n("Error code (0 = no error)", "Fehlercode (0 = kein Fehler)"),
        type: "number",
        role: "value",
        read: true,
        write: false
      },
      value: num(error.value),
      ts: error.ts
    });
    const button2 = v(t, "actuator", id, "default_duration_seconds");
    if (button2.value !== null) {
      states.push({
        id: `${ch}.buttonTime`,
        common: {
          name: n(
            "Watering time when the button on the device is pressed",
            "Bew\xE4sserungsdauer bei Tastendruck am Ger\xE4t"
          ),
          type: "number",
          role: "level.timer",
          unit: "min",
          min: 0,
          max: 600,
          read: true,
          write: true
        },
        value: typeof button2.value === "number" ? Math.round(button2.value / 60) : null,
        ts: button2.ts
      });
    }
  }
}
function addCloseAll(states) {
  states.push({
    id: "closeAll",
    common: {
      name: n("Close all valves", "Alle Ventile schlie\xDFen"),
      type: "boolean",
      role: "button",
      read: false,
      write: true
    }
  });
}
function addSensor(t, kind, channels, states) {
  channels.push({ id: "sensor", name: n("Measured values", "Messwerte") });
  const moisture = v(t, "lemonbeat", "0", kind === "sensor1" ? "soil_humidity" : "soil_moisture");
  states.push({
    id: "sensor.soilMoisture",
    common: {
      name: n("Soil moisture", "Bodenfeuchte"),
      type: "number",
      role: "value.humidity",
      unit: "%",
      min: 0,
      max: 100,
      read: true,
      write: false
    },
    value: num(moisture.value),
    ts: moisture.ts
  });
  const soilTemp = v(t, "lemonbeat", "0", "soil_temperature");
  states.push({
    id: "sensor.soilTemperature",
    common: {
      name: n("Soil temperature", "Bodentemperatur"),
      type: "number",
      role: "value.temperature",
      unit: "\xB0C",
      read: true,
      write: false
    },
    value: num(soilTemp.value),
    ts: soilTemp.ts
  });
  if (kind === "sensor1") {
    const light = v(t, "lemonbeat", "0", "light");
    states.push({
      id: "sensor.light",
      common: {
        name: n("Light intensity", "Lichtst\xE4rke"),
        type: "number",
        role: "value.brightness",
        unit: "lx",
        min: 0,
        read: true,
        write: false
      },
      value: num(light.value),
      ts: light.ts
    });
    const amb = v(t, "lemonbeat", "0", "ambient_temperature");
    states.push({
      id: "sensor.temperature",
      common: {
        name: n("Air temperature", "Lufttemperatur"),
        type: "number",
        role: "value.temperature",
        unit: "\xB0C",
        read: true,
        write: false
      },
      value: num(amb.value),
      ts: amb.ts
    });
  }
  states.push({
    id: "sensor.measure",
    common: { name: n("Measure now", "Jetzt messen"), type: "boolean", role: "button", read: false, write: true }
  });
}
function addPowerAdapter(t, channels, states) {
  channels.push({ id: "power", name: n("Power socket", "Steckdose") });
  const timer = v(t, "lemonbeat", "0", "power_timer");
  const timerValue = num(timer.value);
  states.push({
    id: "power.on",
    common: {
      name: n("Power on (true = on, false = off)", "Strom an (true = an, false = aus)"),
      type: "boolean",
      role: "switch",
      read: true,
      write: true
    },
    value: timerValue === null ? null : timerValue !== 0,
    ts: timer.ts
  });
  states.push({
    id: "power.duration",
    common: {
      name: n('Switch-on time when switched on via "on"', 'Einschaltdauer beim Einschalten \xFCber "on"'),
      type: "number",
      role: "level.timer",
      unit: "min",
      min: 1,
      max: 1440,
      def: 60,
      read: true,
      write: true
    }
  });
}
const MOWER_STATES = {
  parked: "parked",
  leaving: "leaving",
  mowing: "mowing",
  paused: "paused",
  returning: "returning",
  charging: "charging",
  error: "error",
  unknown: "unknown"
};
function mowerState(kind, status, gen2State) {
  if (status === null) {
    return null;
  }
  if (kind === "mower1") {
    if ([7, 8, 16, 17, 18].includes(status)) {
      return "parked";
    }
    if (status === 4) {
      return "leaving";
    }
    if (status === 1 || status === 15) {
      return "mowing";
    }
    if ([0, 5, 6, 9, 10, 14].includes(status)) {
      return "paused";
    }
    if (status === 2) {
      return "returning";
    }
    if (status === 3) {
      return "charging";
    }
    if (status === 12 || status === 13) {
      return "error";
    }
    return "unknown";
  }
  switch (status) {
    case 1:
      return "charging";
    case 2:
      return "leaving";
    case 3:
      return "mowing";
    case 4:
      return "returning";
    case 5:
      return "parked";
    case 6:
      return "paused";
    default:
      if (gen2State === 5) {
        return "paused";
      }
      if (gen2State === 3 || gen2State === 8) {
        return "error";
      }
      return "unknown";
  }
}
function button(id, name) {
  return { id, common: { name, type: "boolean", role: "button", read: false, write: true } };
}
function addMowerStatus(t, kind, channels, states) {
  channels.push({ id: "mower", name: n("Mower", "M\xE4hroboter") });
  const raw = kind === "mower1" ? v(t, "lemonbeat", "0", "status") : v(t, "mower_app", "0", "activity");
  const gen2State = kind === "mower2" ? num(v(t, "mower_app", "0", "state").value) : null;
  states.push({
    id: "mower.state",
    common: {
      name: n("State", "Zustand"),
      type: "string",
      role: "text",
      read: true,
      write: false,
      states: MOWER_STATES
    },
    value: mowerState(kind, num(raw.value), gen2State),
    ts: raw.ts
  });
  states.push({
    id: kind === "mower1" ? "mower.status" : "mower.activity",
    common: {
      name: n("State (raw value)", "Zustand (Rohwert)"),
      type: "number",
      role: "value",
      read: true,
      write: false,
      states: kind === "mower1" ? import_models.GEN1_MOWER_STATUS : import_models.GEN2_MOWER_ACTIVITY
    },
    value: num(raw.value),
    ts: raw.ts
  });
  if (kind === "mower1") {
    for (const [res, id, name, unit] of [
      ["charging_cycles", "chargingCycles", n("Charging cycles", "Ladezyklen"), ""],
      ["collisions", "collisions", n("Collisions", "Kollisionen"), ""],
      ["cutting_time", "cuttingTime", n("Cutting time", "M\xE4hzeit"), "h"],
      ["running_time", "runningTime", n("Running time", "Laufzeit"), "h"],
      ["last_error_code", "lastErrorCode", n("Last error code", "Letzter Fehlercode"), ""]
    ]) {
      const val = v(t, "lemonbeat", "0", res);
      if (val.value !== null) {
        states.push({
          id: `mower.${id}`,
          common: {
            name,
            type: "number",
            role: "value",
            ...unit ? { unit } : {},
            read: true,
            write: false
          },
          value: num(val.value),
          ts: val.ts
        });
      }
    }
  }
  states.push({
    id: "mower.duration",
    common: {
      name: n('Mowing time when started via "start"', 'M\xE4hdauer beim Start \xFCber "start"'),
      type: "number",
      role: "level.timer",
      unit: "min",
      min: 1,
      max: 1440,
      def: 60,
      read: true,
      write: true
    }
  });
  states.push(button("mower.start", n('Start mowing (for "duration")', 'M\xE4hen starten (f\xFCr "duration")')));
  states.push(
    button("mower.parkUntilNextTask", n("Park until the next scheduled task", "Parken bis zum n\xE4chsten Zeitplan"))
  );
  states.push(button("mower.parkUntilFurtherNotice", n("Park until further notice", "Parken bis auf Weiteres")));
  if (kind === "mower2") {
    states.push(button("mower.pause", n("Pause at current position", "An aktueller Position pausieren")));
  }
}
function addPump(t, channels, states) {
  channels.push({ id: "pump", name: n("Pump", "Pumpe") });
  const timer = v(t, "lemonbeat", "0", "watering_timer_1");
  const timerValue = num(timer.value);
  states.push({
    id: "pump.on",
    common: {
      name: n("Pump on (true = on, false = off)", "Pumpe an (true = an, false = aus)"),
      type: "boolean",
      role: "switch",
      read: true,
      write: true
    },
    value: timerValue === null ? null : timerValue !== 0,
    ts: timer.ts
  });
  states.push({
    id: "pump.duration",
    common: {
      name: n('Running time when switched on via "on"', 'Laufzeit beim Einschalten \xFCber "on"'),
      type: "number",
      role: "level.timer",
      unit: "min",
      min: 1,
      max: 600,
      def: 30,
      read: true,
      write: true
    }
  });
  const motor = v(t, "lemonbeat", "0", "pump_on_off");
  states.push({
    id: "pump.running",
    common: {
      name: n("Motor running", "Motor l\xE4uft"),
      type: "boolean",
      role: "indicator.working",
      read: true,
      write: false
    },
    value: motor.value === null ? null : motor.value === 1,
    ts: motor.ts
  });
  for (const [res, id, name, role, unit] of [
    ["outlet_pressure", "pressure", n("Outlet pressure", "Ausgangsdruck"), "value.pressure", "bar"],
    ["outlet_temperature", "temperature", n("Water temperature", "Wassertemperatur"), "value.temperature", "\xB0C"],
    ["flow_rate", "flowRate", n("Flow rate", "Durchfluss"), "value.flow", "l/h"],
    ["flow_total", "flowTotal", n("Total water volume", "Gesamte Wassermenge"), "value", "m\xB3"],
    [
      "flow_since_last_reset",
      "flowSinceReset",
      n("Water volume since reset", "Wassermenge seit Zur\xFCcksetzen"),
      "value",
      "m\xB3"
    ],
    ["valve_error_1", "error", n("Error code (0 = no error)", "Fehlercode (0 = kein Fehler)"), "value", ""]
  ]) {
    const val = v(t, "lemonbeat", "0", res);
    if (val.value !== null) {
      states.push({
        id: `pump.${id}`,
        common: { name, type: "number", role, ...unit ? { unit } : {}, read: true, write: false },
        value: num(val.value),
        ts: val.ts
      });
    }
  }
  const mode = v(t, "lemonbeat", "0", "operating_mode");
  if (mode.value !== null) {
    states.push({
      id: "pump.operatingMode",
      common: {
        name: n("Operating mode", "Betriebsart"),
        type: "number",
        role: "level",
        read: true,
        write: true,
        states: { 0: "scheduled", 1: "automatic" }
      },
      value: num(mode.value),
      ts: mode.ts
    });
  }
}
function buildRawStates(dev) {
  const result = [];
  for (const [object, instances] of Object.entries(dev.tree)) {
    if (object === "_urn" || !instances || typeof instances !== "object") {
      continue;
    }
    for (const [instance, resources] of Object.entries(instances)) {
      if (instance === "_urn" || !resources || typeof resources !== "object") {
        continue;
      }
      for (const [resource, field] of Object.entries(resources)) {
        if (!(0, import_protocol.isValueField)(field)) {
          continue;
        }
        let type = "string";
        let role = "text";
        let value = (0, import_protocol.fieldValue)(field);
        if (field.vb !== void 0) {
          type = "boolean";
          role = "indicator";
        } else if (field.vi !== void 0 || field.vf !== void 0) {
          type = "number";
          role = "value";
        } else if (field.vt !== void 0) {
          type = "number";
          role = "value.time";
          value = field.vt * 1e3;
        } else if (field.ai !== void 0) {
          value = (0, import_protocol.decodeIntArray)(field.ai).join(",");
        }
        result.push({
          id: `raw.${safe(object)}.${safe(instance)}.${safe(resource)}`,
          common: { name: `${object}/${instance}/${resource}`, type, role, read: true, write: false },
          value,
          ts: field.ts ? field.ts * 1e3 : void 0
        });
      }
    }
  }
  return result;
}
function safe(part) {
  return part.replace(/[^A-Za-z0-9_-]/g, "_");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDevice,
  buildRawStates,
  deviceName,
  mowerState,
  wateringEnd
});
//# sourceMappingURL=states.js.map
