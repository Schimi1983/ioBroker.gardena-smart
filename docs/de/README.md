# GARDENA smart system – Anleitung

Mit diesem Adapter steuerst und überwachst du deine GARDENA smart Geräte **direkt in deinem Heimnetz**, ohne GARDENA Cloud.
Der Adapter spricht mit deinem GARDENA smart Gateway. Änderungen (z. B. ein Ventil öffnet) kommen sofort an.
Die GARDENA App funktioniert weiterhin wie gewohnt.

> ⚠️ **Frühe Version.** Schwerpunkt sind Water Control und smart Sensor. Andere Geräte sind vorbereitet, aber noch nicht getestet – Rückmeldungen sind willkommen!

## Einrichtung in 3 Schritten

1. **Lokale API am Gateway einschalten**
   Öffne die Webseite deines Gateways im Browser (IP-Adresse eingeben, die findest du in deinem Router), melde dich mit dem Gateway-Passwort an,
   öffne **„Erweiterte Einstellungen“** und schalte **„Lokale API“** ein.
2. **Adapter installieren** und die Einstellungen der Instanz öffnen.
3. **Adresse und Passwort** des Gateways eintragen und speichern. Fertig – deine Geräte erscheinen unter `gardena-smart.0.devices`.

Bei der ersten Verbindung merkt sich der Adapter das Sicherheitszertifikat deines Gateways. Danach spricht er nur noch mit genau diesem Gateway,
dein Passwort kann also nirgendwo anders landen. Hast du das Gateway zurückgesetzt oder getauscht, drücke einmal `info.trustNewCertificate`.

## Optional: Gerätenamen aus der GARDENA-App

Die lokale Verbindung kennt die Namen nicht, die du deinen Geräten in der GARDENA-App gegeben hast. Wenn du sie in ioBroker haben möchtest, trage einen eigenen App-Key ein:

1. Im [Husqvarna Developer Portal](https://developer.husqvarnagroup.cloud/) mit deinem GARDENA-Konto anmelden.
2. Eine neue Anwendung anlegen und **Authentication API** sowie **GARDENA smart system API** verbinden.
3. **Application Key** und **Application Secret** in die Adapter-Einstellungen kopieren (Abschnitt *GARDENA-Cloud*).

Der Adapter liest die Namen dann einmal am Tag (etwa 2 Abfragen). GARDENA erlaubt aktuell 1000 Abfragen pro Woche und Key (im Developer Portal unter „Usage quota“ zu sehen). Den Verbrauch siehst du unter `cloud.quota.*`; `cloud.quota.reset` setzt den Zähler auf 0, z. B. nach einem neuen Key. Namen, die du in ioBroker selbst geändert hast, bleiben erhalten. Automatische Abfragen stoppen, wenn nur noch 10 % des Limits übrig sind – so bleibt immer Luft für Abfragen, die du selbst auslöst. Lehnt GARDENA Abfragen ab, pausiert der Adapter (1 h, dann länger, höchstens 24 h), auch über einen Neustart hinweg.

## Wichtige Datenpunkte

| Datenpunkt | Bedeutung |
| --- | --- |
| `info.online` | Gerät ist erreichbar |
| `info.battery` | Batteriestand in % |
| `info.frostWarning` | `true`, wenn es fast friert – dann besser nicht bewässern |
| `info.identify` | Drücken, damit die LED des Geräts blinkt |
| `valve1.open` | `true` = Ventil auf, `false` = Ventil zu. Zeigt auch den aktuellen Zustand |
| `valve1.duration` | Wie lange das Ventil offen bleibt, wenn du `open` auf `true` setzt (Minuten) |
| `valve1.active` | Bewässerung läuft (auch per Zeitplan oder Taste am Gerät) |
| `valve1.source` | Wer bewässert: `manual`, `schedule` oder `off` |
| `valve1.endTime` | Wann die Bewässerung endet (Zeitstempel, 0 = läuft nicht) – praktisch für „läuft noch 7 min“ |
| `valve1.buttonTime` | Bewässerungsdauer bei Tastendruck am Gerät (Minuten) |
| `sensor.soilMoisture` | Bodenfeuchte in % |
| `sensor.measure` | Drücken, um sofort zu messen |

### Beispiel: Rasen 10 Minuten bewässern (JavaScript-Adapter)

```javascript
const valve = 'gardena-smart.0.devices.<Geräte-ID>.valve1';
setState(`${valve}.duration`, 10);
setState(`${valve}.open`, true); // schließt nach 10 Minuten automatisch
```

## Fragen und Probleme

Bitte ein Issue auf [GitHub](https://github.com/Schimi1983/ioBroker.gardena-smart/issues) anlegen. Stelle dazu die Protokollstufe der Instanz auf `debug` und hänge das Log an.

## Unterstützen

Der Adapter ist kostenlos und bleibt es. Wenn er dir nützt und du Danke sagen möchtest, kannst du die Entwicklung unterstützen:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Schimi1983-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Schimi1983)
[![PayPal](https://img.shields.io/badge/PayPal-Spenden-00457C?logo=paypal&logoColor=white)](https://paypal.me/Schimi1983)

Fehlermeldungen und Ideen in den [Issues](https://github.com/Schimi1983/ioBroker.gardena-smart/issues) helfen genauso.
