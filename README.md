<img src="admin/gardena-smart.png" width="100" alt="Logo">

# ioBroker.gardena-smart

[![NPM version](https://img.shields.io/npm/v/iobroker.gardena-smart.svg)](https://www.npmjs.com/package/iobroker.gardena-smart)
[![Downloads](https://img.shields.io/npm/dm/iobroker.gardena-smart.svg)](https://www.npmjs.com/package/iobroker.gardena-smart)
![Number of Installations](https://iobroker.live/badges/gardena-smart-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/gardena-smart-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.gardena-smart.png?downloads=true)](https://nodei.co/npm/iobroker.gardena-smart/)

**Tests:** ![Test and Release](https://github.com/Schimi1983/ioBroker.gardena-smart/workflows/Test%20and%20Release/badge.svg)

🇩🇪 [Deutsche Anleitung](docs/de/README.md)

## GARDENA smart system adapter for ioBroker

Control and monitor your GARDENA smart system devices – **directly in your home network**, without the GARDENA cloud.
The adapter talks to your GARDENA smart Gateway. Changes (e.g. a valve opens) arrive immediately, there is no polling and no request limit.

The GARDENA app keeps working as before.

> ⚠️ **Early version.** Water Control and smart Sensor are the main focus. Other devices are prepared but not yet tested – feedback is welcome!

## Setup in 3 steps

1. **Switch on the local API of the gateway**
   Open the web page of your gateway in the browser (type its IP address, you find it in your router), log in with the gateway password,
   open **"Advanced settings"** and switch on **"Local API"**.
2. **Install the adapter** and open the settings of the instance.
3. **Enter the address and the password** of the gateway and save. That's it – your devices appear under `gardena-smart.0.devices`.

On the first connection the adapter remembers the security certificate of your gateway. It will only talk to exactly this gateway afterwards,
so your password can't end up somewhere else. If you reset or replace your gateway, press the button `info.trustNewCertificate` once.

## Supported devices

| Device | What you can do | Status |
| --- | --- | --- |
| smart Water Control (1st and 2nd generation) | open/close valve, watering time, button time, battery, temperature | 1st gen: in test |
| smart Irrigation Control (1st and 2nd generation) | open/close each valve, close all valves | untested |
| smart Sensor / Sensor II | soil moisture, soil temperature, light, air temperature, measure now | in test |
| smart Power Adapter | switch on (for a time) / off | untested |
| smart SILENO mowers | status / activity (control follows) | untested |
| smart Pump | general information (more follows) | untested |

Devices the adapter does not know yet are shown with their general information. With the expert option **"Show raw values"** you see
everything the gateway reports – please attach these values when you open an issue for a new device.

### Optional: device names from the GARDENA app

The local connection does not know the names you gave your devices in the GARDENA app. If you want them in ioBroker, enter your own App Key:

1. Sign in to the [Husqvarna Developer Portal](https://developer.husqvarnagroup.cloud/) with your GARDENA account.
2. Create a new application and connect **Authentication API** and **GARDENA smart system API**.
3. Copy **Application Key** and **Application Secret** into the adapter settings (section *GARDENA cloud*).

The adapter then reads the names once a day (about 2 requests). GARDENA currently allows 1000 requests per week per key (shown under "Usage quota" in the Developer Portal). The usage is shown in `cloud.quota.*`; `cloud.quota.reset` sets the counter to 0, e.g. after you created a new key. Names you changed yourself in ioBroker are kept. Automatic requests stop when only 10 % of the limit are left, so there is always room for requests you trigger yourself. If GARDENA rejects requests, the adapter pauses (1 h, then longer, at most 24 h), also across restarts.

## How to use

Each device appears as `gardena-smart.0.devices.<device id>` with its name from the gateway (you can rename it in ioBroker).

| Data point | Meaning |
| --- | --- |
| `info.online` | Device is reachable |
| `info.battery` | Battery level in % |
| `info.signal` | Radio signal in % |
| `info.frostWarning` | `true` if it is close to freezing – better don't water |
| `info.identify` | Press to let the LED of the device flash |
| `valve1.open` | `true` = open valve, `false` = close valve. Shows the current state |
| `valve1.duration` | How long the valve stays open when you set `open` to `true` (minutes) |
| `valve1.active` | Watering is running (also when started by a schedule or the button on the device) |
| `valve1.source` | Who started the watering: `manual`, `schedule` or `off` |
| `valve1.endTime` | When the watering ends (time stamp, 0 = not watering) – handy for "7 min left" |
| `valve1.schedulePaused` / `valve1.pausedUntil` | Schedules are paused / until when |
| `valve1.schedules` | Schedules as stored in the device (start, end, minutes, weekdays) as JSON. With "GARDENA assisted mode" the cloud may shift them – you see the real times. Please pause or change schedules in the GARDENA app: the app does not notice changes made directly on the device. |
| `valve1.buttonTime` | Watering time when someone presses the button on the device (minutes) |
| `sensor.soilMoisture` | Soil moisture in % |
| `sensor.measure` | Press to measure now |

### Example: water the lawn for 10 minutes (JavaScript adapter)

```javascript
const valve = 'gardena-smart.0.devices.<device id>.valve1';
setState(`${valve}.duration`, 10);
setState(`${valve}.open`, true); // closes automatically after 10 minutes
```

## Questions and problems

Please open an issue on [GitHub](https://github.com/Schimi1983/ioBroker.gardena-smart/issues). Set the log level of the instance to `debug` and add the log.

## Support

The adapter is free and stays free. If it is useful to you and you want to say thanks, you can support the development:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Schimi1983-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Schimi1983)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-00457C?logo=paypal&logoColor=white)](https://paypal.me/Schimi1983)

Bug reports and ideas in the [issues](https://github.com/Schimi1983/ioBroker.gardena-smart/issues) help just as much.

## Technical background

- Connection: secure WebSocket to the gateway on port 8443 (local API, provided by GARDENA)
- The protocol was implemented based on the official documentation and library of GARDENA:
  [gardena-smart-local-api](https://github.com/cloudless-garden/gardena-smart-local-api) (no code taken over)

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (Schimi1983) Initial release: local connection to the GARDENA smart Gateway
- (Schimi1983) Water Control: end of the current watering, schedules and schedule pause (read only)
- (Schimi1983) Optional: device names from the GARDENA app via your own App Key, with request counter for the weekly limit
- (Schimi1983) Support links (GitHub Sponsors, PayPal) in the README, in `package.json` (`npm fund`) and at the bottom of the settings page

## License

MIT License

Copyright (c) 2026 Schimi <github@world-mg.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

GARDENA is a registered trademark of GARDENA GmbH. This project is not affiliated with GARDENA or Husqvarna Group.
