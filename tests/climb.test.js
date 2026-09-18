/* Höhenmeter-Wunsch: das Gelände-Raster (eine einzige Anfrage), die Schätzung
   daraus, die Strafe im Score – und dass der Wunsch die Suche sichtbar in eine
   andere Richtung schickt. */

const START = [52.5145, 13.3501];

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Höhenmeter-Wunsch");
  const page = await env.newPage();
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  /* --- Interpolation im Raster --- */
  /* Ebene mit 2 % Steigung nach Osten: Was das Raster liefert, muss die Ebene
     treffen – auf einem Stützpunkt genau, dazwischen nahe dran. */
  const interp = await page.evaluate(() => {
    const lat0 = 52.5, lon0 = 13.4;
    const samples = [];
    for (let x = -2400; x <= 2400; x += 300)
      for (let y = -2400; y <= 2400; y += 300) samples.push({ x, y, e: 100 + 0.02 * x });
    const terr = { lat0, lon0, mPerLat: 110574, mPerLon: 111320 * Math.cos(lat0 * Math.PI / 180),
                   samples, radiusM: 800 };
    const at = (x, y) => elevAt(terr, lat0 + y / 110574, lon0 + x / (111320 * Math.cos(lat0 * Math.PI / 180)));
    return { onPoint: at(600, 300), between: at(450, 150), far: at(-1200, 0), expect: x => 100 + 0.02 * x };
  });
  t.ok("Auf einem Rasterpunkt gilt der Messwert", Math.abs(interp.onPoint - 112) < 0.01,
       interp.onPoint.toFixed(2) + " m");
  t.ok("Dazwischen wird interpoliert", Math.abs(interp.between - 109) < 1.5, interp.between.toFixed(2) + " m");
  t.ok("Auch abseits der Mitte", Math.abs(interp.far - 76) < 1.5, interp.far.toFixed(2) + " m");

  /* --- Schätzung für eine gedachte Schleife --- */
  /* Auf der schiefen Ebene ist die Rechnung nachprüfbar: Eine Schleife mit
     Radius R überwindet genau einmal den Höhenunterschied über ihren
     Durchmesser, hier 2 % × 1600 m = 32 hm auf gut 5 km. */
  const est = await page.evaluate(() => {
    const lat0 = 52.5, lon0 = 13.4;
    const mk = f => {
      const samples = [];
      for (let x = -3000; x <= 3000; x += 300)
        for (let y = -3000; y <= 3000; y += 300) samples.push({ x, y, e: f(x, y) });
      return { lat0, lon0, mPerLat: 110574, mPerLon: 111320 * Math.cos(lat0 * Math.PI / 180),
               samples, radiusM: 800 };
    };
    const ll = L.latLng(lat0, lon0);
    const ramp = mk(x => 100 + 0.02 * x), flat = mk(() => 42);
    return {
      ramp: estimateClimb(loopProbe(ll, 800, 90), ramp),
      flat: estimateClimb(loopProbe(ll, 800, 90), flat),
      probe: loopProbe(ll, 800, 90).length,
      closed: (() => { const p = loopProbe(ll, 800, 90); return segLen(p[0], p[p.length - 1]) < 1; })()
    };
  });
  t.ok("Gedachte Schleife ist geschlossen", est.closed);
  t.ok("Schleife hat genug Stützpunkte", est.probe === 25, est.probe + " Punkte");
  t.ok("Schätzung trifft die schiefe Ebene", est.ramp > 4.5 && est.ramp < 8,
       est.ramp.toFixed(2) + " hm/km (erwartet ≈ 6,4)");
  t.ok("Flaches Gelände ergibt keine Höhenmeter", est.flat < 0.2, est.flat.toFixed(3) + " hm/km");

  /* --- Strafe im Score --- */
  const pen = await page.evaluate(() => {
    const terr = { lo: 5, hi: 25, flat: false };
    const even = { lo: 8, hi: 10, flat: true };
    return {
      flatLo: climbPenalty(5, terr, "flat"), flatHi: climbPenalty(25, terr, "flat"),
      hillLo: climbPenalty(5, terr, "hill"), hillHi: climbPenalty(25, terr, "hill"),
      mid: climbPenalty(15, terr, "flat"),
      any: climbPenalty(25, terr, "any"),
      even: climbPenalty(10, even, "hill"),
      over: climbPenalty(60, terr, "flat"),
      weight: CLIMB_WEIGHT
    };
  });
  t.ok("Flachster Kandidat kostet nichts", pen.flatLo === 0);
  t.ok("Bergigster Kandidat kostet vollen Einsatz", Math.abs(pen.flatHi - pen.weight) < 1e-9,
       pen.flatHi.toFixed(3));
  t.ok("Bei „bergig“ ist es genau umgekehrt", pen.hillLo === pen.flatHi && pen.hillHi === pen.flatLo);
  t.ok("Dazwischen wird linear gewichtet", Math.abs(pen.mid - pen.weight / 2) < 1e-9, pen.mid.toFixed(3));
  t.ok("Ohne Wunsch keine Strafe", pen.any === 0);
  t.ok("Gleichförmiges Gelände kostet nichts", pen.even === 0);
  t.ok("Ausreißer werden gedeckelt", pen.over === pen.weight, pen.over.toFixed(3));
  t.ok("Strafe bleibt schwächer als ein Zipfel", pen.weight < 0.2, "Gewicht " + pen.weight);

  /* --- Der Scan selbst: eine Anfrage, danach Cache --- */
  const before = env.requests.length;
  const scan = await page.evaluate(async () => {
    terrain = null;
    const t1 = await scanTerrain(L.latLng(52.5145, 13.3501), 800);
    const t2 = await scanTerrain(L.latLng(52.5145, 13.3501), 800);
    return { n: t1.samples.length, dirs: t1.dirs.length, lo: t1.lo, hi: t1.hi, flat: t1.flat,
             cached: t1 === t2, key: t1.key };
  });
  const scanReqs = env.requests.slice(before).filter(u => u.includes("api.open-meteo.com")).length;
  t.ok("Der Scan kostet genau eine Anfrage", scanReqs === 1, scanReqs + " Anfrage(n)");
  t.ok("Vier Ringe plus Mittelpunkt werden abgetastet", scan.n === 97, scan.n + " Stützpunkte");
  t.ok("Alle Richtungen bekommen eine Schätzung", scan.dirs === 24, scan.dirs + " Richtungen");
  t.ok("Der zweite Aufruf nimmt den Cache", scan.cached);
  t.ok("Spanne ist sinnvoll geordnet", scan.hi >= scan.lo && scan.hi > 0,
       `${scan.lo.toFixed(1)}–${scan.hi.toFixed(1)} hm/km`);
  t.ok("Testgelände ist nicht eben", !scan.flat);

  const wrap = await page.evaluate(() => ({
    same: dirClimbAt(terrain, 0) === dirClimbAt(terrain, 360),
    neg: dirClimbAt(terrain, -15) === dirClimbAt(terrain, 345),
    inRange: terrain.dirs.every(d => d >= terrain.lo - 1e-9 && d <= terrain.hi + 1e-9)
  }));
  t.ok("Richtungen laufen über 360° hinaus rund", wrap.same && wrap.neg);
  t.ok("Jede Richtung liegt in der Spanne", wrap.inRange);

  /* --- Bedienung: Knopf trägt den Zustand --- */
  t.ok("Knopf zeigt zunächst keinen Wunsch",
       await page.evaluate(() => !climbBtn.classList.contains("set") && /Höhe/.test(climbBtn.textContent)));
  await page.click("#climbBtn");
  t.ok("Popover geht auf", await page.locator("#climbPop.show").count() === 1);
  t.ok("Popover bleibt im Bild", await page.evaluate(() => {
    const r = document.getElementById("climbPop").getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  }));
  await page.click('.climbOpt[data-wish="hill"]');
  const set = await page.evaluate(() => ({
    wish: settings.climbWish,
    stored: JSON.parse(localStorage.getItem("roundtrip-settings")).climbWish,
    label: climbBtn.textContent.trim(),
    marked: climbBtn.classList.contains("set"),
    open: document.getElementById("climbPop").classList.contains("show")
  }));
  t.ok("Auswahl wird übernommen", set.wish === "hill");
  t.ok("Auswahl überlebt das Neuladen", set.stored === "hill");
  t.ok("Der Knopf sagt, was eingestellt ist", /Bergig/.test(set.label), set.label);
  t.ok("Und hebt sich sichtbar ab", set.marked);
  t.ok("Popover schließt nach der Wahl", !set.open);

  await page.click("#climbBtn");
  await page.keyboard.press("Escape");
  t.ok("Esc schließt das Popover", await page.locator("#climbPop.show").count() === 0);

  /* --- Wirkung: derselbe Start, zwei Wünsche, zwei Richtungen --- */
  /* Die Startrichtung wird sonst gewürfelt – für den Vergleich muss sie bei
     beiden Läufen dieselbe sein, sonst vergleicht man Zufall mit Zufall. */
  await page.evaluate(s => {
    Math.random = () => 0.25;
    map.setView(s, 15);
    setStart(L.latLng(s[0], s[1]), false);
  }, START);
  await page.fill("#distInput", "4");

  async function runWish(wish) {
    await page.evaluate(w => { settings.climbWish = w; saveSettings(); renderClimbBtn(); }, wish);
    await page.click("#genBtn");
    await page.waitForFunction(() => !busy && lastRoute, { timeout: 60000 });
    return page.evaluate(() => ({
      climb: lastRoute.climb, dist: lastRoute.distance,
      wish: routeCtx.wish, status: document.getElementById("status").textContent,
      scanned: !!(terrain && terrain.dirs)
    }));
  }
  const hill = await runWish("hill");
  const flat = await runWish("flat");

  t.ok("Vor der Suche wird das Gelände geprüft", hill.scanned && hill.wish === "hill");
  t.ok("Statuszeile benennt den Wunsch", /bergig gewünscht/.test(hill.status),
       hill.status.replace(/\s+/g, " ").slice(0, 90).trim());
  t.ok("Und wechselt mit ihm", /flach gewünscht/.test(flat.status),
       flat.status.replace(/\s+/g, " ").slice(0, 90).trim());
  t.ok("„bergig“ findet mehr Höhenmeter als „flach“", hill.climb > flat.climb,
       `${hill.climb?.toFixed(1)} vs ${flat.climb?.toFixed(1)} hm/km`);
  t.ok("Die Zieldistanz bleibt trotzdem gewahrt",
       Math.abs(hill.dist - 4000) / 4000 < 0.25 && Math.abs(flat.dist - 4000) / 4000 < 0.25,
       `${Math.round(hill.dist)} m / ${Math.round(flat.dist)} m`);

  /* --- Höhenmeter auf den Chips --- */
  await page.waitForFunction(() => !searching, { timeout: 60000 });
  await page.waitForFunction(
    () => variants.length < 2 || variants.filter(v => v.elev).length >= 2, { timeout: 60000 }).catch(() => {});
  const chips = await page.evaluate(() => ({
    n: variants.length,
    withElev: variants.filter(v => v.elev).length,
    texts: [...document.querySelectorAll("#variants .vchip:not(.pending)")].map(c => c.textContent.trim()),
    status: document.getElementById("status").textContent
  }));
  t.ok("Varianten holen ihr Profil im Hintergrund", chips.n < 2 || chips.withElev >= 2,
       `${chips.withElev}/${chips.n}`);
  t.ok("Chips weisen die Höhenmeter aus", chips.n < 2 || chips.texts.every(x => /↑ \d+ hm/.test(x)),
       chips.texts.join(" | "));
  t.ok("Statuszeile nennt sie auch", /↑ \d+ hm/.test(chips.status),
       chips.status.replace(/\s+/g, " ").slice(0, 90).trim());

  /* --- Markierung: die Schätzung steuert, das echte Profil entscheidet --- */
  const mark = await page.evaluate(() => {
    const asc = variants.map(v => climbOf(v));
    return { pick: bestClimbVariant(), asc, wish: routeCtx.wish,
             marked: [...document.querySelectorAll("#variants .vchip .hm")]
               .map(h => /🏞️|⛰️/.test(h.textContent)) };
  });
  if (mark.asc.length >= 2 && mark.asc.every(a => a != null)) {
    const want = mark.asc.indexOf(Math.min(...mark.asc));   // Wunsch ist hier „flach“
    t.ok("Der flachste Vorschlag wird markiert", mark.pick === want,
         `markiert ${mark.pick + 1}, flachster ${want + 1} (${mark.asc.join(" / ")} hm)`);
    t.ok("Und zwar genau einer", mark.marked.filter(Boolean).length === 1,
         mark.marked.filter(Boolean).length + " Markierungen");
    t.ok("Die angezeigte Route wird dabei nicht ausgetauscht",
         await page.evaluate(() => activeVariant === 0));
  }

  /* Angezeigt werden dürfen nur echte Höhenmeter – die Schätzung aus dem
     Raster ist grob und hat in der Oberfläche nichts verloren. */
  const honest = await page.evaluate(() => {
    const asc = climbOf(lastRoute);
    return { asc, est: lastRoute.climb, shown: document.getElementById("status").textContent };
  });
  t.ok("Angezeigt wird das echte Profil, nicht die Schätzung",
       honest.asc != null && new RegExp("↑ " + honest.asc + " hm").test(honest.shown),
       `Profil ${honest.asc} hm · Schätzung ${honest.est?.toFixed(1)} hm/km`);

  t.ok("Keine JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
  return t;
};
