/* Verhalten, wenn der Höhen-Dienst nicht mitspielt. Der freie Dienst hängt
   gelegentlich – das Profil darf dann nicht stillschweigend verschwinden. */

const ROUTE = {
  coords: [[52.500, 13.400], [52.508, 13.412], [52.512, 13.398], [52.503, 13.392], [52.500, 13.400]],
  distance: 2600
};

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Höhenprofil-Ausfall");
  const page = await env.newPage();

  let mode = "fail";          // fail | hang | ok
  await page.route("**/api.open-meteo.com/**", async route => {
    if (mode === "fail") return route.abort("connectionfailed");
    if (mode === "hang") return new Promise(() => {});     // antwortet nie
    return route.fallback();                                // an den Harness weitergeben
  });

  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  /* --- Dienst antwortet mit Fehler: Meldung + Wiederholen-Knopf --- */
  const t0 = Date.now();
  await page.evaluate(r => loadElevation(r), ROUTE);
  await page.waitForSelector("#elevRetry", { timeout: 30000 });
  const secs = (Date.now() - t0) / 1000;
  t.ok("Ausfall wird gemeldet", /nicht verfügbar/.test(await page.locator("#elevSummary").textContent()));
  t.ok("Zweiter Versuch läuft automatisch", secs > 0.8, `Meldung nach ${secs.toFixed(1)} s`);
  t.ok("Diagrammfläche bleibt eingeklappt", !(await page.locator("#elevChart").isVisible()));
  t.ok("Kein Marker bleibt auf der Karte zurück", await page.evaluate(() => !elevMarker));

  /* --- Dienst wieder da: Knopf lädt nach --- */
  mode = "ok";
  await page.click("#elevRetry");
  await page.waitForFunction(() => elevData !== null, { timeout: 30000 });
  t.ok("Wiederholen lädt das Profil nach", await page.evaluate(() => elevData.elev.length > 50));
  t.ok("Fehlerzustand ist aufgehoben",
       !(await page.locator("#elevBox").evaluate(e => e.classList.contains("failed"))));
  t.ok("Auf- und Abstieg erscheinen", /hm/.test(await page.locator("#elevSummary").textContent()));

  /* --- Verbindung hängt: Abbruch per Zeitlimit statt Dauerladen --- */
  mode = "hang";
  const t1 = Date.now();
  await page.evaluate(r => loadElevation({ ...r, elev: null }), ROUTE);
  await page.waitForSelector("#elevRetry", { timeout: 90000 });
  const hangSecs = (Date.now() - t1) / 1000;
  t.ok("Hängende Anfrage bricht ab (2 × 12 s)", hangSecs > 12 && hangSecs < 45, hangSecs.toFixed(1) + " s");

  /* --- Späte Antwort einer alten Route überschreibt nichts --- */
  mode = "ok";
  await page.evaluate(async r => {
    loadElevation({ ...r, elev: null });                                  // Anfrage 1
    loadElevation({ coords: r.coords.slice().reverse(), distance: 2600 }); // Anfrage 2 überholt sie
  }, ROUTE);
  await page.waitForFunction(() => elevData !== null, { timeout: 30000 });
  await page.waitForTimeout(800);
  t.ok("Nur die jüngste Anfrage zählt", await page.evaluate(() => elevData.elev.length > 50));

  const real = page.errors.filter(e => !/ERR_CONNECTION_FAILED|Failed to load resource/.test(e));
  t.ok("Keine JS-Fehler", real.length === 0, real.join(" | "));
  await page.close();
  return t;
};
