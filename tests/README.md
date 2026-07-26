# Tests

Die App ist eine einzelne `index.html` ohne Bauschritt. Getestet wird sie
deshalb so, wie sie ausgeliefert wird: in einem echten Chromium, über einen
kleinen lokalen Webserver.

## Ausführen

```bash
npm install                 # einmalig, holt Playwright
npx playwright install chromium
npm test                    # alle Suiten, ohne Netzzugang
npm test -- ui core         # nur einzelne Suiten
npm run test:live           # gegen die echten Dienste
```

Rückgabewert 0 heißt: alles bestanden. Genau das prüft die CI
(`.github/workflows/ci.yml`) bei jedem Push und Pull Request.

## Ohne Netz – und warum

Standardmäßig beantwortet `stub.js` alle externen Adressen selbst:

| Dienst | Ersatz |
| --- | --- |
| OSRM (Fuß/Rad/Auto) | synthetische Route entlang der angefragten Wunschpunkte, leicht ausgebeult, damit Doppelstrecken- und Rundheits-Metriken etwas zu rechnen haben |
| Open-Meteo (Höhen) | glattes, künstliches Relief |
| Nominatim (Ortsnamen) | feste Adresse |
| Kartenkacheln, Marker-Grafiken | 1×1-PNG |
| Leaflet | einmalig nach `tests/.cache/` geladen, danach von dort |

Das hat drei Gründe: der Lauf ist deterministisch (keine Zufallszahlen im
Ersatz, Antworten hängen nur an den Koordinaten), er ist schnell (rund 40 s),
und er belastet die freien Dienste nicht bei jedem Push. Die echten Dienste
sind zeitweise langsam oder nicht erreichbar – als Merge-Bedingung wäre das
nicht brauchbar.

`LIVE=1` schaltet auf die echten Dienste um; das ist der Lauf für „stimmt es
auch draußen?“. Die Anfragen gehen dabei über `curl`, damit der Browser im
Container keine eigene Zertifikatskette braucht.

Läuft eine Adresse auf, die weder abgedeckt noch lokal ist, meldet der Lauf sie
am Ende als „nicht abgedeckte Adresse“ – dann gehört sie in `stub.js`.

## Suiten

| Suite | Prüft |
| --- | --- |
| `core` | Rechenkern: Link-Kodierung, Linien-Vereinfachung, Abtastung, Höhen-Statistik samt Glättung, Doppelstrecken- und Rundheits-Metrik, Anzeigeformate |
| `ui` | Ablauf: Route erzeugen, Varianten im Hintergrund, Höhenprofil samt Zeiger, Teilen-Link (in zweitem Tab geöffnet), Navi-Link, Speichern/Export/Import, Thema, Panel, Fahrrad, unroutbarer Start |
| `elevation` | Verhalten, wenn der Höhen-Dienst Fehler liefert, hängt oder verspätet antwortet |
| `layout` | Beschriftung der Buttons über zwölf Bildschirmbreiten von 320 bis 1280 px: nichts läuft über, Symbole nur bei wenig Platz, Bezeichnungen für Vorlesehilfen bleiben |

## Wenn ein Test rot ist

Die Ausgabe nennt jede Prüfung mit Messwert, z. B.
`✓ Rasterrauschen bleibt nahe null — ↑ 3 hm (ungeglättet wären es 87)`.
Bei Änderungen am Algorithmus ändern sich Messwerte, nicht das Bestehen: die
Grenzen sind absichtlich weit gesetzt (Zieldistanz ±25 %), damit eine
Verbesserung nicht als Fehler erscheint. Wird eine Grenze verletzt, ist
entweder das Verhalten schlechter geworden oder die Erwartung veraltet – beides
gehört angesehen, nicht weggeschoben.
