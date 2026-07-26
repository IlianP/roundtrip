/* Durchlauf durch die Bedienung: Route erzeugen, Varianten im Hintergrund,
   Höhenprofil, Teilen-Link, Speichern/Export/Import, Thema, Panel, Fahrrad. */

const START = [52.5145, 13.3501];

module.exports = async function run(env) {
  const { suite, LIVE } = require("./harness");
  const t = suite("Bedienung");
  const long = LIVE ? 180000 : 30000;
  const page = await env.newPage();
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  t.ok("Seite lädt ohne JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  t.ok("Drei Verkehrsmittel vorhanden", await page.locator(".seg button").count() === 3);

  await page.evaluate(s => { map.setView(s, 15); setStart(L.latLng(s[0], s[1]), false); }, START);
  t.ok("Startpunkt gesetzt", await page.evaluate(() => !!start));

  /* --- Erzeugen: erste Route sofort, Rest im Hintergrund --- */
  await page.fill("#distInput", "3");
  const t0 = Date.now();
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy && lastRoute, { timeout: long });
  const tFirst = (Date.now() - t0) / 1000;
  const early = await page.evaluate(() => ({
    dist: lastRoute.distance, n: variants.length, searching, busy,
    chip: !!document.querySelector(".vchip.pending"),
    free: !document.getElementById("genBtn").disabled && !document.getElementById("saveBtn").disabled
  }));
  t.ok("Route liegt in der Zieldistanz (3 km ± 25 %)", early.dist > 2250 && early.dist < 3750,
       Math.round(early.dist) + " m");
  t.ok("Bedienung ist sofort wieder frei", early.free && !early.busy, `nach ${tFirst.toFixed(1)} s`);
  t.ok("Alternativen werden im Hintergrund gesucht", early.searching && early.chip,
       `${early.n} Variante(n) beim Anzeigen`);

  await page.waitForFunction(() => !searching, { timeout: long });
  const all = await page.evaluate(() => ({
    n: variants.length, act: activeVariant, dist: lastRoute.distance, ghosts: ghostLines.length
  }));
  t.ok("Weitere Varianten kommen nach", all.n > early.n, `${early.n} → ${all.n}`);
  t.ok("Angezeigte Route wird nicht ausgetauscht", all.act === 0 && Math.abs(all.dist - early.dist) < 1);
  t.ok("Nicht aktive Varianten liegen auf der Karte", all.ghosts === (all.n - 1) * 2, all.ghosts + " Layer");
  t.ok("Chips zeigen alle Varianten", await page.locator("#variants .vchip:not(.pending)").count() === all.n);
  t.ok("Such-Chip verschwindet am Ende", await page.locator(".vchip.pending").count() === 0);

  /* --- Höhenprofil --- */
  await page.waitForFunction(() => elevData !== null, { timeout: long }).catch(() => {});
  const elev = await page.evaluate(() => elevData && {
    n: elevData.elev.length,
    summary: document.getElementById("elevSummary").textContent,
    range: document.getElementById("elevRange").textContent,
    paths: document.querySelectorAll("#elevChart path").length
  });
  t.ok("Höhenprofil geladen", !!elev && elev.n > 50, elev ? elev.n + " Stützpunkte" : "fehlt");
  t.ok("Auf- und Abstieg ausgewiesen", !!elev && /hm/.test(elev.summary), elev && elev.summary.trim());
  t.ok("Höhenbereich ausgewiesen", !!elev && /m ü\. NN/.test(elev.range), elev && elev.range);
  t.ok("Fläche und Linie gezeichnet", !!elev && elev.paths === 2);

  const box = await page.locator("#elevChart").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(150);
  t.ok("Zeiger nennt Kilometer und Höhe", /km · \d+ m/.test(await page.locator("#elevTip").textContent()),
       (await page.locator("#elevTip").textContent()).trim());
  t.ok("Zeiger setzt Marker auf die Karte", await page.evaluate(() => !!elevMarker));
  await page.mouse.move(box.x + box.width * 0.5, box.y - 80);
  await page.waitForTimeout(150);
  t.ok("Marker verschwindet beim Verlassen", await page.evaluate(() => !elevMarker));

  /* --- Variante wechseln --- */
  if (all.n >= 2) {
    const before = await page.evaluate(() => lastRoute.distance);
    await page.locator("#variants .vchip").nth(1).click();
    await page.waitForFunction(() => activeVariant === 1 && !busy, { timeout: long });
    const sw = await page.evaluate(() => ({ d: lastRoute.distance, pol: !!variants[1].polished,
                                            chip: document.querySelector(".vchip.active").textContent }));
    t.ok("Variante 2 wird aktiv", sw.d !== before && /Variante 2/.test(sw.chip), Math.round(sw.d) + " m");
    t.ok("Variante 2 wird beim Auswählen nachbearbeitet", sw.pol);
    await page.locator("#variants .vchip").nth(0).click();
    await page.waitForFunction(() => activeVariant === 0 && !busy, { timeout: long });
    t.ok("Zurück auf Variante 1", await page.evaluate(() => activeVariant === 0));
  }

  /* --- Teilen-Link --- */
  const url = await page.evaluate(() => shareUrl(lastRoute));
  const orig = await page.evaluate(() => lastRoute.distance);
  t.ok("Link bleibt kurz", url.length < 4096, url.length + " Zeichen");
  t.ok("Link ist URL-sicher", url === encodeURI(url) && !/[\\^`{|}]/.test(url));

  const page2 = await env.newPage();
  await page2.goto(url, { waitUntil: "load" });
  await page2.waitForFunction(() => typeof window.L !== "undefined" && lastRoute, { timeout: 20000 });
  const shared = await page2.evaluate(() => {
    let geo = 0;
    for (let i = 1; i < lastRoute.coords.length; i++) geo += segLen(lastRoute.coords[i - 1], lastRoute.coords[i]);
    return { d: lastRoute.distance, geo, mode, st: document.getElementById("status").textContent };
  });
  t.ok("Geteilte Route meldet die echte Länge", Math.abs(shared.d - orig) < 1,
       `${Math.round(shared.d)} m vs ${Math.round(orig)} m`);
  t.ok("Geglättete Linie bleibt nah am Original", Math.abs(shared.geo - orig) / orig < 0.02,
       `${((shared.geo - orig) / orig * 100).toFixed(1)} %`);
  t.ok("Verkehrsmittel wird übernommen", shared.mode === "foot");
  t.ok("Status weist den Link aus", /Geteilte Route/.test(shared.st), shared.st.slice(0, 50).trim());
  t.ok("Geteilte Seite ohne JS-Fehler", page2.errors.length === 0, page2.errors.join(" | "));
  await page2.close();

  /* --- Navigation --- */
  const navi = await page.evaluate(() => naviUrl(lastRoute));
  t.ok("Navi-Link nutzt den Fuß-Modus", navi.includes("travelmode=walking"));
  t.ok("Navi-Link hat acht Zwischenziele",
       decodeURIComponent(navi.split("waypoints=")[1]).split("|").length === 8);

  /* --- Speichern, Export, Import --- */
  await page.click("#saveBtn");
  await page.waitForFunction(() => savedRoutes.length === 1, { timeout: long });
  const saved = await page.evaluate(() => savedRoutes[0]);
  t.ok("Route wird gespeichert", saved.coords.length > 10, saved.name);
  t.ok("Höhendaten werden mitgespeichert", saved.elev && saved.elev.length > 50,
       saved.elev && saved.elev.length + " Punkte");
  t.ok("Name enthält Ort und Distanz", /km/.test(saved.name));

  await page.click("#routesBtn");
  const dl = page.waitForEvent("download", { timeout: 20000 });
  await page.click("#exportBtn");
  const download = await dl;
  const file = await download.path();
  const json = JSON.parse(require("fs").readFileSync(file, "utf8"));
  t.ok("Export ist gültiges JSON mit allen Routen", json.app === "roundtrip" && json.routes.length === 1,
       download.suggestedFilename());

  await page.evaluate(() => { savedRoutes = []; persistRoutes(); renderRoutes(); });
  await page.setInputFiles("#importFile", file);
  await page.waitForFunction(() => savedRoutes.length === 1, { timeout: 20000 });
  t.ok("Import stellt die Route wieder her", await page.evaluate(() => savedRoutes[0].coords.length > 10));
  await page.setInputFiles("#importFile", file);
  await page.waitForTimeout(600);
  t.ok("Doppelter Import legt keine Dublette an", await page.evaluate(() => savedRoutes.length) === 1);

  const errsBefore = page.errors.length;
  await page.setInputFiles("#importFile", { name: "kaputt.json", mimeType: "application/json",
                                            buffer: Buffer.from("{kein json") });
  await page.waitForTimeout(600);
  const broken = await page.evaluate(() => ({ n: savedRoutes.length,
                                              toast: document.getElementById("toast").textContent }));
  t.ok("Defekte Datei wird abgefangen und gemeldet",
       broken.n === 1 && /fehlgeschlagen/.test(broken.toast) && page.errors.length === errsBefore,
       broken.toast);

  await page.locator(".routeItem [data-act=load]").first().click();
  await page.waitForTimeout(800);
  t.ok("Gespeicherte Route lädt samt Profil", await page.evaluate(() =>
    !!lastRoute && !!elevData && document.getElementById("elevBox").classList.contains("show")));

  /* --- Thema --- */
  const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector(".panel")).backgroundColor);
  await page.click("#themeBtn");
  await page.waitForTimeout(250);
  const dark = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.querySelector(".panel")).backgroundColor,
    line: routeLine.options.color,
    filter: getComputedStyle(document.querySelector(".leaflet-tile-pane")).filter,
    btn: document.getElementById("themeBtn").textContent
  }));
  t.ok("Dunkles Thema wird aktiv", dark.attr === "dark" && dark.bg !== lightBg, dark.bg);
  t.ok("Routenfarbe folgt dem Thema", dark.line.toLowerCase() === "#5b9dff", dark.line);
  t.ok("Kartenkacheln werden abgedunkelt", dark.filter !== "none" && dark.filter.length > 4);
  t.ok("Umschalter zeigt die Gegenrichtung", dark.btn === "☀️");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  t.ok("Thema überlebt das Neuladen",
       await page.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark");
  await page.evaluate(() => { settings.theme = "auto"; saveSettings(); applyTheme(); });

  /* --- Panel einklappen (Handy-Breite) --- */
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(250);
  const openH = (await page.locator("#panelBody").boundingBox()).height;
  await page.click("#panelToggle");
  await page.waitForTimeout(450);
  const closedH = (await page.locator("#panelBody").boundingBox()).height;
  t.ok("Panel klappt ein", closedH < 2 && openH > 100, `${Math.round(openH)} → ${Math.round(closedH)}`);
  t.ok("Statuszeile bleibt sichtbar", await page.locator("#status").isVisible());
  t.ok("Griff ist auf dem Handy sichtbar", await page.locator("#grabber").isVisible());
  await page.click("#grabber");
  await page.waitForTimeout(450);
  t.ok("Panel klappt wieder auf", (await page.locator("#panelBody").boundingBox()).height > 100);
  await page.setViewportSize({ width: 1000, height: 780 });

  /* --- Fahrrad --- */
  const before = env.requests.length;
  await page.evaluate(s => { setMode("bike"); setStart(L.latLng(s[0], s[1]), false); }, START);
  await page.fill("#distInput", "5");
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy && lastRoute, { timeout: long });
  const bike = await page.evaluate(() => ({ d: lastRoute.distance, title: routeTitle(lastRoute),
                                            navi: naviUrl(lastRoute) }));
  t.ok("Rad-Route liegt in der Zieldistanz (5 km ± 25 %)", bike.d > 3750 && bike.d < 6250,
       Math.round(bike.d) + " m");
  t.ok("Rad-Profil des Routers wird angefragt",
       env.requests.slice(before).some(u => u.includes("routed-bike")));
  t.ok("Rad-Navi-Link", bike.navi.includes("travelmode=bicycling"));
  t.ok("GPX-Titel nennt das Verkehrsmittel", /Fahrrad/.test(bike.title), bike.title);

  /* --- Neue Erzeugung verwirft die alte Hintergrundsuche --- */
  await page.evaluate(s => { setMode("foot"); setStart(L.latLng(s[0], s[1]), false); }, START);
  await page.fill("#distInput", "3");
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy && lastRoute && searching, { timeout: long });
  const tok = await page.evaluate(() => genToken);
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy && lastRoute, { timeout: long });
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => ({ tok: genToken, n: variants.length, act: activeVariant }));
  t.ok("Alte Suche wird verworfen", after.tok > tok && after.act === 0 && after.n <= 3,
       `${after.n} Varianten, Token ${tok} → ${after.tok}`);
  await page.evaluate(() => cancelSearch());

  /* --- Fehlerfall: unroutbarer Startpunkt (mitten im Atlantik) --- */
  await page.evaluate(() => { setStart(L.latLng(30.0, -40.0), false); });
  await page.fill("#distInput", "3");
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy, { timeout: long });
  const err = await page.evaluate(() => document.getElementById("status").textContent);
  t.ok("Unroutbarer Start meldet einen Fehler statt stumm zu bleiben",
       /Keine Route gefunden|Routing fehlgeschlagen/.test(err), err.slice(0, 70).trim());

  t.ok("Keine JS-Fehler bis zum Schluss", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
  return t;
};
