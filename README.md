# Hebammen-Logbuch

Persönliche Web-App für eine freiberufliche Hebamme: Termine nach dem Hausbesuch diktieren, gegen die Regeln des Hebammenhilfevertrags (Fassung ab 01.04.2026) prüfen und am Bürotag Zeile für Zeile auf die AZH-Versichertenbestätigung abschreiben.

- Alle Daten bleiben im Browser des Handys (localStorage). Sicherung als JSON-Datei unter „Frauen“.
- Spracherkennung mit [Parakeet TDT 0.6B v3](https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4) über [parakeet.js](https://github.com/ysdede/parakeet.js), lokal per WebGPU. Einmaliger Download ca. 410 MB.
- Optional ein kleines Sprachmodell über WebLLM, das nur Lücken füllt (experimentell).
- Die Zuordnung (Frau, Leistung, Art, Zeiten, Kilometer, Material) macht eine Regel-Erkennung in `index.html` (`normalizeSpoken`, `parseNote`).

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | App, Regelwerk (`LEISTUNGEN`, `MATERIAL`, `check`) und Ansichten |
| `ki/ki.js` | Spracherkennung und Sprachmodell, wird zu `vendor/ki.bundle.js` gebaut |
| `sw.js` | Offline-Betrieb |

## Bundle neu bauen

```bash
cd ki && npm install && npm run build
```

Nach jeder Änderung an `vendor/ki.bundle.js` oder den App-Dateien `VERSION` in `sw.js` hochzählen, sonst bekommt das Handy die alte Fassung aus dem Cache.

Die Regeln sind nach bestem Wissen aus dem Vergütungsverzeichnis übernommen und ersetzen keine Prüfung durch die Abrechnungsstelle.
