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
var models_exports = {};
__export(models_exports, {
  GEN1_COMMAND: () => GEN1_COMMAND,
  GEN1_MOWER_STATUS: () => GEN1_MOWER_STATUS,
  GEN2_ACTUATOR_STATES: () => GEN2_ACTUATOR_STATES,
  GEN2_COMMAND_SOURCE: () => GEN2_COMMAND_SOURCE,
  GEN2_FROST_TEMPERATURE: () => GEN2_FROST_TEMPERATURE,
  GEN2_LINK_QUALITY_PERCENT: () => GEN2_LINK_QUALITY_PERCENT,
  GEN2_MOWER_ACTIVITY: () => GEN2_MOWER_ACTIVITY,
  MODEL_KINDS: () => MODEL_KINDS
});
module.exports = __toCommonJS(models_exports);
const MODEL_KINDS = {
  // Gen1 (Lemonbeat)
  18869: "waterControl1",
  31653: "irrigationControl1",
  18845: "sensor1",
  19040: "sensor2",
  35279: "powerAdapter",
  22538: "pump",
  6146: "mower1",
  29694: "mower1",
  53988: "mower1",
  // Gen2 (LwM2M)
  2812: "waterControl2",
  2814: "waterControl2",
  2826: "waterControl2",
  469: "irrigationControl2",
  488: "mower2"
};
const GEN1_COMMAND = {
  measureSoilMoisture: 2,
  measureSoilTemperature: 3,
  measureLight: 4,
  measureAmbientTemperature: 5,
  measureBattery: 6,
  measureRfLink: 7,
  closeAllValves: 22,
  identify: 37
};
const GEN2_COMMAND_SOURCE = "18";
const GEN2_ACTUATOR_STATES = {
  0: "inactive",
  1: "starting",
  2: "active",
  3: "stopping"
};
const GEN1_MOWER_STATUS = {
  0: "PAUSED",
  1: "OK_CUTTING_AUTO",
  2: "OK_SEARCHING_CS",
  3: "OK_CHARGING",
  4: "OK_LEAVING_CS",
  5: "WAIT_SOFTWARE_DOWNLOAD",
  6: "WAIT_POWER_UP",
  7: "PARKED_WEEK_TIMER",
  8: "PARKED_BY_USER",
  9: "OFF_MAIN_SWITCH",
  10: "WAIT_STOP_PRESSED",
  11: "UNKNOWN",
  12: "ERROR",
  13: "ERROR_POWER_UP",
  14: "WAIT",
  15: "OK_CUTTING_MANUAL",
  16: "PARKED_AUTOTIMER",
  17: "PARKED_DAY_LIMIT",
  18: "PARKED_FROST"
};
const GEN2_MOWER_ACTIVITY = {
  0: "NONE",
  1: "CHARGING",
  2: "GOING_OUT",
  3: "MOWING",
  4: "GOING_HOME",
  5: "PARKED",
  6: "STOPPED_IN_GARDEN"
};
const GEN2_LINK_QUALITY_PERCENT = { 0: 20, 1: 50, 2: 90 };
const GEN2_FROST_TEMPERATURE = 5;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GEN1_COMMAND,
  GEN1_MOWER_STATUS,
  GEN2_ACTUATOR_STATES,
  GEN2_COMMAND_SOURCE,
  GEN2_FROST_TEMPERATURE,
  GEN2_LINK_QUALITY_PERCENT,
  GEN2_MOWER_ACTIVITY,
  MODEL_KINDS
});
//# sourceMappingURL=models.js.map
