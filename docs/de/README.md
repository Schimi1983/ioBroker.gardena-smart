# GARDENA smart system – Anleitung

Mit diesem Adapter steuerst und überwachst du deine GARDENA smart Geräte **direkt in deinem Heimnetz**, ohne GARDENA Cloud.
Der Adapter spricht mit deinem GARDENA smart Gateway. Änderungen (z. B. ein Ventil öffnet) kommen sofort an.
Die GARDENA App funktioniert weiterhin wie gewohnt.

> ⚠️ **Frühe Version.** Getestet mit Water Control und smart Sensor (1. Generation). Die anderen Geräte sind nach der Dokumentation von
> GARDENA umgesetzt, aber noch nicht an echter Hardware getestet – Rückmeldungen sind sehr willkommen!

## Einrichtung in 3 Schritten

1. **Lokale API am Gateway einschalten**
   Öffne die Webseite deines Gateways im Browser (IP-Adresse eingeben, die findest du in deinem Router), melde dich mit dem Gateway-Passwort an,
   öffne **„Erweiterte Einstellungen“** und schalte **„Lokale API“** ein. (Braucht eine aktuelle Gateway-Firmware – fehlt der Schalter, das Gateway in der GARDENA App aktualisieren.)
2. **Adapter installieren** und die Einstellungen der Instanz öffnen.
3. **Adresse und Passwort** des Gateways eintragen und speichern. Fertig – deine Geräte erscheinen unter `gardena-smart.0.devices`.

Bei der ersten Verbindung merkt sich der Adapter das Sicherheitszertifikat deines Gateways. Danach spricht er nur noch mit genau diesem Gateway,
dein Passwort kann also nirgendwo anders landen. Hast du das Gateway zurückgesetzt oder getauscht, drücke einmal `info.trustNewCertificate`.

## Unterstützte Geräte

| Gerät | Was geht | Getestet |
| --- | --- | --- |
| smart Water Control | Ventil auf/zu, Bewässerungsdauer, Ende der Bewässerung, Tastendauer, Zeitpläne, Batterie, Temperatur | ✅ 1. Gen. · ❔ 2. Gen. |
| smart Sensor / Sensor II | Bodenfeuchte, Bodentemperatur, Licht und Lufttemperatur (Sensor I), sofort messen | ✅ Sensor II |
| smart Irrigation Control | jedes Ventil auf/zu, alle Ventile schließen | ❔ |
| smart Zwischenstecker (Power Adapter) | einschalten (für eine Zeit) / aus | ❔ |
| smart SILENO Mähroboter | Status, Start für eine Zeit, Parken bis zum nächsten Zeitplan / bis auf Weiteres, Pause (2. Gen.) | ❔ |
| smart Haus- & Gartenautomat (Pumpe) | an/aus, Druck, Durchfluss, Temperatur, Betriebsart | ❔ |

✅ an echter Hardware getestet · ❔ umgesetzt, noch nicht getestet – bitte gib Bescheid, wie es bei dir läuft.

Geräte, die der Adapter noch nicht kennt, erscheinen mit ihren allgemeinen Infos. Mit der Expertenoption **„Rohwerte anzeigen“** siehst du
alles, was das Gateway meldet – bitte hänge diese Werte an, wenn du ein Issue für ein neues Gerät anlegst.

## So nutzt du den Adapter

Jedes Gerät erscheint als `gardena-smart.0.devices.<Geräte-ID>`. Du kannst es in ioBroker umbenennen – oder der Adapter übernimmt die Namen
aus der GARDENA App (siehe unten).

| Datenpunkt | Bedeutung |
| --- | --- |
| `info.online` | Gerät ist erreichbar |
| `info.battery` / `info.signal` | Batteriestand / Funksignal in % |
| `info.frostWarning` | `true`, wenn es fast friert – dann besser nicht bewässern |
| `info.identify` | Drücken, damit die LED des Geräts blinkt |
| `valve1.open` | `true` = Ventil auf, `false` = Ventil zu. Zeigt auch den aktuellen Zustand |
| `valve1.duration` | Wie lange das Ventil offen bleibt, wenn du `open` auf `true` setzt (Minuten) |
| `valve1.active` / `valve1.source` | Bewässerung läuft / wer sie gestartet hat: `manual` (Adapter, App oder Taste), `schedule` oder `off` |
| `valve1.endTime` | Wann die Bewässerung endet (Zeitstempel, 0 = läuft nicht) – praktisch für „läuft noch 7 min“ |
| `valve1.buttonTime` | Bewässerungsdauer bei Tastendruck am Gerät (Minuten) |
| `valve1.schedules` | Zeitpläne im Gerät (Start, Ende, Minuten, Wochentage) als JSON – siehe Hinweis unten |
| `valve1.schedulePaused` / `valve1.pausedUntil` | Zeitpläne angehalten / bis wann |
| `sensor.soilMoisture` / `sensor.soilTemperature` | Bodenfeuchte in % / Bodentemperatur in °C |
| `sensor.measure` | Drücken, um sofort zu messen |
| `power.on`, `pump.on`, `mower.start` … | Gerät für die Zeit im passenden `duration` einschalten bzw. starten |

**Zeitpläne:** Bitte in der GARDENA App anlegen, ändern oder pausieren. Die App bekommt Änderungen direkt am Gerät nicht mit.
Im „GARDENA-unterstützten Modus“ verschiebt die Cloud Startzeiten und Dauer – `valve1.schedules` zeigt, wann das Gerät wirklich bewässert.

### Beispiel: Rasen 10 Minuten bewässern (JavaScript-Adapter)

```javascript
const valve = 'gardena-smart.0.devices.<Geräte-ID>.valve1';
setState(`${valve}.duration`, 10);
setState(`${valve}.open`, true); // schließt nach 10 Minuten automatisch
```

## Optional: Gerätenamen aus der GARDENA App

Die lokale Verbindung kennt die Namen nicht, die du deinen Geräten in der GARDENA App gegeben hast. Wenn du sie in ioBroker haben möchtest, trage einen eigenen App-Key ein:

1. Im [Husqvarna Developer Portal](https://developer.husqvarnagroup.cloud/) mit deinem GARDENA-Konto anmelden.
2. Eine neue Anwendung anlegen und **Authentication API** sowie **GARDENA smart system API** verbinden.
3. **Application Key** und **Application Secret** in die Adapter-Einstellungen kopieren (Abschnitt *GARDENA-Cloud*).

Der Adapter liest die Namen etwa einmal am Tag (2 Abfragen). GARDENA erlaubt 1000 Abfragen pro Woche und Key – der Adapter zählt
seine Abfragen unter `cloud.quota.*` und bremst lange vor dem Limit von selbst. Namen, die du in ioBroker selbst geändert hast, bleiben erhalten.

## Fragen und Probleme

Bitte ein Issue auf [GitHub](https://github.com/Schimi1983/ioBroker.gardena-smart/issues) anlegen. Stelle dazu die Protokollstufe der Instanz auf `debug` und hänge das Log an.

## Unterstützen

Der Adapter ist kostenlos und bleibt es. Wenn er dir nützt und du Danke sagen möchtest, kannst du die Entwicklung unterstützen:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Schimi1983-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Schimi1983)
[![PayPal](https://img.shields.io/badge/PayPal-Spenden-00457C?logo=paypal&logoColor=white)](https://paypal.me/Schimi1983)

Fehlermeldungen und Ideen in den [Issues](https://github.com/Schimi1983/ioBroker.gardena-smart/issues) helfen genauso.
