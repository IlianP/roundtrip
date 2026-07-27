# 🔄 Roundtrip – Rundkurs-Planer

Roundtrip plant **Rundkurse** (Start = Ziel) für Fußgänger, Radfahrer und
Autofahrer: Ausgangspunkt und Wunschdistanz eingeben, die App sucht eine
reale, straßenbasierte Route, die möglichst nah an diese Distanz herankommt,
dabei rund verläuft und wenig „Zipfel" (Strecken, die zweimal befahren
werden) enthält.

Die gesamte Anwendung ist **eine einzige `index.html`** – kein Build-Schritt,
kein Bundler, kein Backend. Öffnen (lokal oder gehostet) genügt.

## Inhalt

- [Was die App macht](#was-die-app-macht)
- [Schnellstart](#schnellstart)
- [Funktionen im Detail](#funktionen-im-detail)
- [Der Rundkurs-Algorithmus](#der-rundkurs-algorithmus)
- [Verwendete Dienste](#verwendete-dienste)
- [Architektur der `index.html`](#architektur-der-indexhtml)
- [Daten & Speicherung](#daten--speicherung)
- [Tests](#tests)
- [Projektstruktur](#projektstruktur)
- [Browser-Voraussetzungen](#browser-voraussetzungen)
- [Bekannte Grenzen](#bekannte-grenzen)

## Was die App macht

1. Startpunkt wählen – per Adresssuche, Klick auf die Karte oder eigenem
   Live-Standort.
2. Zieldistanz und Verkehrsmittel (Fuß/Rad/Auto) angeben.
3. **Route erzeugen** – die App verteilt Zwischenpunkte kreisförmig um den
   Start, lässt die reale Strecke bei einem OSRM-Routing-Server berechnen und
   passt Radius und Wegpunkte iterativ an, bis Distanz, Rundheit und
   Doppelstrecken-Anteil passen.
4. Ergebnis: eine fertig geroutete Schleife mit Höhenprofil, die man als
   Link teilen, als GPX exportieren, in Google Maps öffnen oder lokal
   speichern kann.

## Schnellstart

Kein `npm install` nötig, um die App selbst zu benutzen – es gibt keine
Abhängigkeiten zur Laufzeit (Leaflet wird von einem CDN geladen). Einfach
öffnen:

```bash
# lokal ansehen
python3 -m http.server 8000    # oder: npx serve
# → http://localhost:8000/index.html
```

Für Geolocation (Live-Standort, „Eigenen Standort verwenden") verlangt der
Browser einen sicheren Kontext (`https://` oder `localhost`).

Zum Entwickeln/Testen (siehe [Tests](#tests)) wird Node.js gebraucht:

```bash
npm install                 # holt Playwright (Chromium)
npx playwright install chromium
npm test
```

## Funktionen im Detail

- **Startpunkt** per Adresssuche (Nominatim), Karten-Klick oder Live-GPS.
- **Drei Verkehrsmittel** (Fuß/Rad/Auto), jeweils mit eigenem OSRM-Routing-
  Profil und eigenen Vorgaben für Wegpunktzahl und Warnschwellen.
- **Distanz-Toleranz** einstellbar (± % der Zieldistanz, Standard 5 %).
- **Autobahn vermeiden** (nur Auto-Modus): bestraft Routenanteile mit
  Geschwindigkeits-Annotation ≥ 80 km/h im Score, statt sie hart
  auszuschließen (die freien OSRM-Server unterstützen `exclude=motorway`
  nicht).
- **Varianten („🎲 Würfeln")**: Nach der ersten brauchbaren Route sucht die
  App im Hintergrund bis zu drei sichtbar unterschiedliche Alternativen in
  anderen Himmelsrichtungen und zeigt sie als gestrichelte „Geister-Linien"
  auf der Karte sowie als Chips im Panel.
- **Höhenprofil**: Flächendiagramm mit Auf-/Abstieg, Min/Max, interaktivem
  Fadenkreuz (Maus/Touch) mit passendem Marker auf der Karte.
- **Teilen & Navigation**:
  - Link mit dem kompletten (vereinfachten) Streckenverlauf, kodiert im
    URL-Fragment – kein Server nötig, jeder mit dem Link sieht exakt dieselbe
    Route.
  - GPX-Export/-Versand (Web-Share-API, sonst Download).
  - Öffnen in Google Maps (dort nur angenähert, da Google maximal ~9
    Zwischenziele erlaubt).
- **Gespeicherte Routen**: lokal in `localStorage`, umbenennbar, mit
  Export/Import als JSON-Datei (Sicherung/Übertragung zwischen Geräten).
- **Live-Standort**: dauerhaft blinkender Standortpunkt samt
  Genauigkeitskreis (wie in Google Maps), erkennt veraltete Fixes (grau,
  Blinken aus) und Berechtigungsverweigerung.
- **Hell/Dunkel-Thema**: automatisch (Systemeinstellung) oder manuell,
  inklusive angepasster Kartenkacheln per CSS-Filter.
- **Responsives Layout**: Panel wird auf schmalen Bildschirmen zur
  ausziehbaren Bottom-Sheet (Wisch-Geste am Griff); Button-Beschriftungen
  weichen bei wenig Platz Icons, über CSS-Container-Queries gesteuert –
  nicht über Media Queries, da die verfügbare Breite vom Panel abhängt, nicht
  vom Viewport.

## Der Rundkurs-Algorithmus

Der Kern der App (siehe die ausführlichen Kommentare in `index.html` ab
`================= Roundtrip-Algorithmus =================`):

1. **Kreis-Wegpunkte**: Um den Startpunkt wird ein Kreis mit Umfang ≈
   Zieldistanz gelegt; darauf werden (je nach Verkehrsmittel und
   Gebietstyp) 3–7 Zwischenpunkte verteilt. Die Startrichtung ist
   zufällig, weitere Versuche verteilen sich gleichmäßig über 360°, damit
   z. B. garantiert eine Variante an einem Fluss vorbeiführt statt immer
   an derselben Stelle zu scheitern.
2. **Reales Routing**: Die Wegpunkte gehen als eine Anfrage an OSRM
   (`osrmRoute`), das die tatsächliche Straßenroute liefert – inklusive
   Geschwindigkeits-Annotationen im Auto-Modus (für die
   Autobahn-Erkennung) und der Schnapp-Distanz jedes Wegpunkts zum
   Straßennetz (Indikator für ländliche/städtische Gegend).
3. **Bewertung** jedes Kandidaten über mehrere Metriken:
   - **Abweichung** von der Zieldistanz.
   - **Doppelstrecken-Anteil** („Zipfel"): rasterbasierte Nahbereichs­analyse
     (`overlapAnalysis`), die erkennt, wenn Streckenabschnitte, die auf der
     Route weit auseinanderliegen, sich räumlich sehr nahekommen (Hin- und
     Rückweg derselben Straße, getrennte Richtungsfahrbahnen einer
     Autobahn, Sackgassen-Stichfahrten).
   - **Rundheit**: isoperimetrischer Quotient `Q = 4πA/L²` (Kreis = 1) –
     Zipfel verlängern die Strecke, ohne Fläche einzuschließen, und drücken
     `Q` deutlich.
   - **Schnellstraßen-Anteil** (nur Auto, falls „Autobahn vermeiden" aktiv).
   - **Pinch/Spike**: geometrische Erkennung des größten „Zipfel-Halses" –
     zwei Punkte der Route, die räumlich nah, aber entlang der Strecke weit
     auseinander liegen.
   
   Alle Größen fließen in einen gewichteten `scoreOf`-Score; bis zu einer
   weichen Grenze (10 % bzw. eingestellte Toleranz) kostet Distanz­abweichung
   fast nichts, danach wird sie schnell teuer – Rundheit und Zipfelfreiheit
   wiegen also stärker als Zentimetergenauigkeit.
4. **Iterative Anpassung**: Der Kreisradius wird nach jeder Anfrage
   proportional zur tatsächlich gefahrenen Distanz nachjustiert (gedämpft
   auf Faktor 0,4–2,5), bis die Toleranz erreicht ist oder das
   Anfragebudget (`MAX_ITER`, `REQUEST_BUDGET`) ausgeschöpft ist.
5. **Zipfel-Chirurgie**: Erzwingt ein Wegpunkt eine Stichfahrt (Hin- und
   Rückweg über dieselbe Straße), wird genau dieser Wegpunkt im nächsten
   Versuch ausgelassen (`spurWaypointIndex`); der Radius gleicht die
   fehlende Länge danach automatisch aus.
6. **Nachbearbeitung (`polish`)** der besten gefundenen Route:
   - `repairPinches`: ersetzt lokal nur den Abschnitt zwischen den beiden
     Halspunkten eines Zipfels durch eine direkt geroutete Verbindung –
     ohne die ganze Route neu zu berechnen.
   - `closeLoopEarly`: ist die Route trotzdem zu lang, wird ein Punkt nahe
     am Start gesucht, dort gekappt und direkt zum Start zurückgeroutet.
7. **Varianten im Hintergrund**: Sobald die erste brauchbare Route steht,
   sucht `collectVariants` weitere, räumlich klar unterscheidbare
   Kandidaten (`isDistinctVariant`, Vergleich der Routen-Schwerpunkte) in
   den übrigen Startrichtungen, ohne die Bedienung zu blockieren.

Alle Konstanten des Algorithmus (`MAX_ITER`, `MAX_SEEDS`, `REQUEST_BUDGET`,
`GOOD_OVERLAP`, `MIN_ROUNDNESS`, `MAX_SNAP_M`, …) stehen gesammelt im
Konfigurationsblock am Anfang des `<script>`-Teils.

## Verwendete Dienste

Alles über frei nutzbare, öffentliche Dienste – kein eigenes Backend, keine
API-Keys:

| Dienst | Zweck | Grenzen |
| --- | --- | --- |
| [OSRM](https://routing.openstreetmap.de) (FOSSGIS-Instanzen, Fallback `router.project-osrm.org` fürs Auto) | Straßenrouting Fuß/Rad/Auto | Freie Demo-Server: `ITER_DELAY_MS`-Pause zwischen Anfragen, begrenztes `REQUEST_BUDGET` pro Rundkurs |
| [Open-Meteo Elevation API](https://open-meteo.com) | Höhenprofil (Copernicus-90-m-Raster) | Max. `ELEV_SAMPLES` (100) Punkte pro Anfrage; Timeout + ein Wiederholungsversuch |
| [Nominatim](https://nominatim.openstreetmap.org) | Adresssuche, Reverse-Geocoding für Standardnamen gespeicherter Routen | Nutzungsrichtlinien von OSM beachten |
| OpenStreetMap-Kacheln | Kartendarstellung | – |
| [Leaflet](https://leafletjs.com) 1.9.4 (CDN, `cdnjs`) | Kartenbibliothek | einzige externe Skript-/CSS-Abhängigkeit |
| Google Maps (nur Link, kein API-Call) | Turn-by-turn-Navigation | max. ~9 Zwischenziele → Route wird angenähert |

Da alle Dienste kostenlos und öffentlich sind, geht die App bewusst sparsam
mit Anfragen um (Anfragebudget, Anfrage-Pause, clientseitiges Caching der
Höhendaten pro Route).

## Architektur der `index.html`

Die Datei ist bewusst monolithisch, intern aber klar in Abschnitte
gegliedert (per Kommentar-Überschriften `================= … =================`):

```
<style>            Design-Tokens (CSS-Variablen, hell/dunkel), Panel,
                    Buttons, Varianten-Chips, Höhenprofil, Modals, Toast,
                    Live-Standort-Punkt, Responsive-/Container-Queries
<body>              Karte, Bedienpanel, Einstellungen-Modal, Routen-Modal,
                    Teilen-Sheet, Toast
<script>
  Konfiguration      OSRM-Endpunkte, Modus-Metadaten, Algorithmus-Konstanten
  State              Route/Varianten/Höhenprofil/Live-Standort-Zustand
  Karte              Leaflet-Setup, Live-Standort-Kartenbutton
  Geometrie-Helfer   Haversine, Zieldestination, Abtastung, Vereinfachung
  OSRM               osrmRoute()
  Roundtrip-Algo.    searchSeed, makeRoundTrip, collectVariants, polish, …
  UI-Aktionen        Route zeichnen, Varianten, Status, Formatierung
  Höhenprofil        Laden, Glätten, Zeichnen, Zeiger-Interaktion
  Teilen/Navigation  Link-Kodierung (eigenes Base64-Alphabet), GPX, Google Maps
  Gespeicherte Routen localStorage, Export/Import als JSON
  Live-Standort      watchPosition + Heartbeat + Render-Drosselung
  Standort & Suche   Geolocation-Button, Nominatim-Adresssuche
  Einstellungen      laden/speichern (localStorage)
  Erscheinungsbild   Theme anwenden, Leaflet-Ebenen nachziehen
  DOM-Verdrahtung    Event-Handler, Panel ein-/ausklappen, Deep-Link laden
```

## Daten & Speicherung

Es gibt keinen eigenen Server und kein Tracking. Persistiert wird
ausschließlich lokal im Browser (`localStorage`):

- `roundtrip-settings` – Toleranz, Autobahn-Einstellung, Theme.
- `roundtrip-routes` – gespeicherte Routen (Koordinaten, Wegpunkte,
  Höhenprofil, Metadaten).

Ein **geteilter Link** enthält die komplette (vereinfachte) Streckengeometrie
im URL-Fragment (`#r=1~modus~km~dauer~meter~verlauf`) – das Fragment wird nie
an einen Server geschickt, die Route bleibt clientseitig.

## Tests

Ausführliche Dokumentation in [`tests/README.md`](tests/README.md); hier die
Kurzfassung.

Getestet wird die App so, wie sie ausgeliefert wird: als statische Datei in
einem echten Chromium (Playwright), über einen kleinen lokalen Webserver –
kein Bauschritt, keine Mocks auf Code-Ebene.

```bash
npm test                    # alle Suiten, ohne Netzzugang (Stubs)
npm test -- ui core         # nur einzelne Suiten
npm run test:live           # gegen die echten Dienste (OSRM, Open-Meteo, Nominatim)
```

Standardmäßig antwortet `tests/stub.js` auf alle externen Anfragen
(synthetische, aber realistisch „krumme" Routen, glattes künstliches Relief,
feste Adressen, 1×1-PNG-Kacheln) – deterministisch, schnell (~40 s) und ohne
Last für die freien Dienste. `LIVE=1` schaltet auf die echten Dienste um.

| Suite | Prüft |
| --- | --- |
| `core` | Rechenkern: Link-Kodierung, Linien-Vereinfachung, Abtastung, Höhen-Statistik samt Glättung, Doppelstrecken- und Rundheits-Metrik, Anzeigeformate |
| `ui` | Ablauf: Route erzeugen, Varianten im Hintergrund, Höhenprofil samt Zeiger, Teilen-Link, Navi-Link, Speichern/Export/Import, Thema, Panel, Fahrrad, unroutbarer Start |
| `elevation` | Verhalten, wenn der Höhen-Dienst Fehler liefert, hängt oder verspätet antwortet |
| `layout` | Beschriftung der Buttons über zwölf Bildschirmbreiten von 320–1280 px |

CI (`.github/workflows/ci.yml`) läuft bei jedem Push und Pull Request und
sollte in den Branch-Protection-Regeln als erforderliche Prüfung eingetragen
sein.

## Projektstruktur

```
index.html              Die gesamte App (Markup, Style, Logik)
package.json             npm-Skripte (test, test:live) + Playwright als Dev-Dependency
tests/
  run.js                 Test-Runner (Suiten auswählen, Ergebnis zusammenfassen)
  harness.js              Browser-/Server-Setup, Netz-Abfang, Leaflet-Cache
  stub.js                 Synthetische Antworten für OSRM/Open-Meteo/Nominatim
  core.test.js, ui.test.js, elevation.test.js, layout.test.js
  README.md               Ausführliche Test-Dokumentation
.github/workflows/ci.yml Testlauf bei Push/PR
```

## Browser-Voraussetzungen

- Ein aktueller Browser mit Unterstützung für CSS-Container-Queries,
  `color-mix()` und ES2020+.
- **Geolocation** (Live-Standort, „Eigenen Standort verwenden") funktioniert
  nur in einem sicheren Kontext (`https://` oder `localhost`).
- Web-Share-API wird optional genutzt (GPX direkt „senden"); ohne sie fällt
  die App auf Datei-Download zurück.

## Bekannte Grenzen

- Die freien OSRM-Demo-Server sind gelegentlich langsam oder nicht
  erreichbar; die App begrenzt deshalb Anfragen (`REQUEST_BUDGET`) und
  pausiert zwischen Iterationen (`ITER_DELAY_MS`), statt sie zu überlasten.
- `exclude=motorway` wird von den freien OSRM-Servern nicht unterstützt –
  „Autobahn vermeiden" bestraft Schnellstraßen-Anteile daher im Score,
  statt sie hart auszuschließen.
- Google Maps erlaubt maximal ~9 Zwischenziele; die Navigation dorthin ist
  eine Annäherung. Für den exakten Verlauf: GPX-Export oder Teilen-Link.
- Alles läuft im Browser, ohne eigenes Backend – entsprechend sind
  gespeicherte Routen geräte- bzw. browserlokal (Export/Import als JSON zum
  manuellen Übertragen).
