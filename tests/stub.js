/* Synthetische Antworten für Routing, Höhen und Geocoding.
   Zweck: Die Tests sollen in der CI ohne Netz laufen, deterministisch sein und
   die freien Dienste (FOSSGIS/OSRM, Open-Meteo, Nominatim) nicht bei jedem Push
   belasten. Die Geometrie ist bewusst „krumm“ – eine gerade Verbindung wäre für
   die Zipfel- und Rundheits-Metriken der App kein realistischer Prüfstein.

   Für einen Lauf gegen die echten Dienste: LIVE=1 node tests/run.js */

const R = 6371008.8;
const toRad = d => d * Math.PI / 180;

function segLen(a, b) {                       // Haversine, wie in der App
  const dp = toRad(b[0] - a[0]), dl = toRad(b[1] - a[1]);
  const s = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* Deterministischer Zahlenwert aus Koordinaten – ersetzt Zufall, damit
   dieselbe Anfrage immer dieselbe Antwort liefert. */
function hash01(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    const v = Math.round(n * 1e5) | 0;
    h = Math.imul(h ^ (v & 0xffff), 16777619);
    h = Math.imul(h ^ (v >>> 16), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const SPEED = { foot: 1.35, bike: 4.2, car: 13.5 };   // m/s

/* Verbindet zwei Punkte mit einer leicht ausgebeulten Linie (~10 % länger als
   die Luftlinie), so wie eine echte Straße selten schnurgerade verläuft. */
function leg(a, b) {
  const straight = segLen(a, b);
  const steps = Math.max(4, Math.min(60, Math.round(straight / 25)));
  const amp = 0.09 * (hash01(a[0], a[1], b[0], b[1]) - 0.5) * 2;   // Vorzeichen + Stärke
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = a[0] + (b[0] - a[0]) * t, lon = a[1] + (b[1] - a[1]) * t;
    // Auslenkung senkrecht zur Verbindung, in der Mitte am größten
    const bulge = Math.sin(Math.PI * t) * amp;
    pts.push([lat - (b[1] - a[1]) * bulge * 0.5, lon + (b[0] - a[0]) * bulge * 0.5]);
  }
  pts[0] = [a[0], a[1]];
  pts[pts.length - 1] = [b[0], b[1]];
  return pts;
}

/* Prüffeld „offener Atlantik“: hier antwortet auch der echte Router mit
   NoRoute. So lässt sich der Fehlerfall ohne Netz nachstellen. */
const isOcean = ([lat, lon]) => lon > -60 && lon < -20 && lat > 10 && lat < 50;

/* OSRM-Antwort für beliebig viele Wunschpunkte nachbauen. */
function osrmResponse(url) {
  const profile = /routed-bike|\/bike\//.test(url) ? "bike"
                : /routed-car|\/driving\//.test(url) ? "car" : "foot";
  const coordPart = url.split("?")[0].split("/").pop();
  const wanted = coordPart.split(";").map(p => {
    const [lon, lat] = p.split(",").map(Number);
    return [lat, lon];
  });
  if (wanted.length < 2 || wanted.some(c => !isFinite(c[0]) || !isFinite(c[1])))
    return { code: "InvalidQuery" };
  if (wanted.some(isOcean)) return { code: "NoRoute" };

  const coords = [];
  const legs = [];
  for (let i = 1; i < wanted.length; i++) {
    const pts = leg(wanted[i - 1], wanted[i]);
    let d = 0;
    const dist = [], speed = [];
    for (let k = 1; k < pts.length; k++) {
      const l = segLen(pts[k - 1], pts[k]);
      d += l; dist.push(l);
      speed.push(profile === "car" ? 15 : SPEED[profile]);   // < 22 m/s ⇒ keine Schnellstraße
    }
    legs.push({ distance: d, duration: d / SPEED[profile], annotation: { distance: dist, speed } });
    coords.push(...(i === 1 ? pts : pts.slice(1)));
  }
  const distance = legs.reduce((a, l) => a + l.distance, 0);
  return {
    code: "Ok",
    waypoints: wanted.map((c, i) => ({ distance: 4 + 6 * hash01(c[0], c[1], i) })),
    routes: [{
      distance, duration: distance / SPEED[profile], legs,
      geometry: { coordinates: coords.map(c => [c[1], c[0]]) }
    }]
  };
}

/* Sanftes, aber nicht flaches Höhenrelief – liefert plausible Höhenmeter. */
function elevationResponse(url) {
  const q = new URL(url).searchParams;
  const lats = (q.get("latitude") || "").split(",").map(Number);
  const lons = (q.get("longitude") || "").split(",").map(Number);
  const elevation = lats.map((lat, i) => {
    const lon = lons[i] ?? lons[0];
    const h = 180
      + 30 * Math.sin(lat * 420) + 22 * Math.cos(lon * 380)
      + 8 * Math.sin(lat * 1500 + lon * 900);
    return Math.round(h * 10) / 10;
  });
  return { elevation };
}

function nominatimResponse(url) {
  if (url.includes("/reverse"))
    return { address: { suburb: "Teststadt", city: "Musterstadt" } };
  return [{ display_name: "Teststraße 1, Teststadt", lat: "52.51450", lon: "13.35010" }];
}

/* 1×1-PNG statt echter Kartenkacheln */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64");

/* Liefert {contentType, body} oder null, wenn die Adresse nicht abgedeckt ist. */
function respond(url) {
  // Kartenkacheln und Leaflets Marker-Grafiken
  if (/\.(png|svg|gif|jpe?g|webp)($|\?)/.test(url) || url.includes("tile.openstreetmap.org"))
    return { contentType: "image/png", body: TILE };
  if (url.includes("/route/v1/")) return { contentType: "application/json", body: JSON.stringify(osrmResponse(url)) };
  if (url.includes("api.open-meteo.com")) return { contentType: "application/json", body: JSON.stringify(elevationResponse(url)) };
  if (url.includes("nominatim.openstreetmap.org")) return { contentType: "application/json", body: JSON.stringify(nominatimResponse(url)) };
  return null;
}

module.exports = { respond, segLen, TILE };
