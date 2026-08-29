/* Hinweg aufzeichnen und später einen anderen Weg zurück finden.

   Die Fixes kommen nicht vom echten GPS, sondern über onLivePos() – also über
   genau die Stelle, an der auch watchPosition() landet. Der Weg vom Fix über
   Filter, Speicherung, Karte und Neuladen bis zum fertigen Rückweg läuft damit
   vollständig durch, bleibt aber deterministisch und schnell. */

const A = [52.5145, 13.3501];      // Startpunkt der Aufzeichnung
const STEP_M = 15;                 // Abstand zweier Fixes
const FIXES = 80;                  // ⇒ Hinweg ca. 1,2 km schnurgerade nach Osten

/* Punkte streng nach Osten – der Hinweg ist damit eine gerade Linie, deren
   Umgebung der Rückweg messbar meiden muss. */
function eastwardTrack() {
  const dLon = STEP_M / (111320 * Math.cos(A[0] * Math.PI / 180));
  return Array.from({ length: FIXES }, (_, i) => [A[0], +(A[1] + i * dLon).toFixed(6)]);
}

const feed = (page, pts, accuracy = 8) => page.evaluate(([pts, accuracy]) => {
  for (const p of pts) onLivePos({ coords: { latitude: p[0], longitude: p[1], accuracy } }, true);
}, [pts, accuracy]);

module.exports = async function run(env) {
  const { suite, LIVE } = require("./harness");
  const t = suite("Aufzeichnung & Rückweg");
  const long = LIVE ? 180000 : 40000;
  const page = await env.newPage();
  page.on("dialog", d => d.accept());          // „Aufzeichnung verwerfen?"
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  const pts = eastwardTrack();
  const B = pts[pts.length - 1];

  /* --- Ausgangszustand: nichts aufgezeichnet --- */
  const idle = await page.evaluate(() => ({
    del: getComputedStyle(document.getElementById("trackDelBtn")).display,
    back: getComputedStyle(document.getElementById("backRow")).display,
    title: document.getElementById("trackTitle").textContent.trim(),
    rec: document.getElementById("recBtn").textContent.trim()
  }));
  t.ok("Ohne Aufzeichnung nur der Aufnahme-Knopf", idle.del === "none" && idle.back === "none");
  t.ok("Knopf lädt zum Aufzeichnen ein", /Aufzeichnen/.test(idle.rec), idle.rec);

  /* --- Aufzeichnen --- */
  await page.click("#recBtn");
  t.ok("Aufzeichnung läuft", await page.evaluate(() => track.recording));
  t.ok("Kopfzeile zeigt den Aufnahmezustand",
       /Aufzeichnung läuft/.test(await page.locator("#trackTitle").textContent()));

  await feed(page, pts);
  const rec = await page.evaluate(() => ({
    n: track.points.length, dist: track.distance,
    line: !!trackLine, dest: !!trackDestMarker,
    stats: document.getElementById("trackStats").textContent,
    back: getComputedStyle(document.getElementById("backRow")).display
  }));
  t.ok("Jeder Fix landet in der Aufzeichnung", rec.n === FIXES, `${rec.n} von ${FIXES}`);
  t.ok("Länge stimmt mit der abgelaufenen Strecke überein",
       Math.abs(rec.dist - (FIXES - 1) * STEP_M) < 20, Math.round(rec.dist) + " m");
  t.ok("Hinweg liegt auf der Karte", rec.line && rec.dest);
  t.ok("Anzeige nennt Länge, Dauer und Punktzahl", /km|m/.test(rec.stats) && /Punkte/.test(rec.stats),
       rec.stats);
  t.ok("Rückweg-Knopf erscheint", rec.back !== "none");

  /* --- Was nicht in die Aufzeichnung gehört --- */
  const dLon = STEP_M / (111320 * Math.cos(A[0] * Math.PI / 180));
  const filtered = await page.evaluate(([B, dLon]) => {
    const before = track.points.length;
    const call = (lat, lon, acc) => onLivePos({ coords: { latitude: lat, longitude: lon, accuracy: acc } }, true);
    call(B[0], B[1] + dLon * 0.2, 8);          // 3 m weiter: Rauschen im Stand
    const afterNoise = track.points.length;
    call(B[0] + 0.002, B[1], 250);             // brauchbare Distanz, aber viel zu ungenau
    const afterAcc = track.points.length;
    call(B[0], B[1] + dLon * 300, 8);          // 4,5 km in einem Schritt: unmöglich
    const afterJump = track.points.length;
    call(B[0], B[1] + dLon, 8);                // ein sauberer Schritt zählt weiter
    return { before, afterNoise, afterAcc, afterJump, afterGood: track.points.length };
  }, [B, dLon]);
  t.ok("Rauschen im Stand wird verworfen", filtered.afterNoise === filtered.before);
  t.ok("Ungenaue Fixes werden verworfen", filtered.afterAcc === filtered.before);
  t.ok("Unmögliche Sprünge werden verworfen", filtered.afterJump === filtered.before);
  t.ok("Ein sauberer Schritt zählt weiter", filtered.afterGood === filtered.before + 1);

  /* --- Die Aufzeichnung überlebt das Neuladen („But Later") --- */
  await page.waitForFunction(n => {
    const raw = localStorage.getItem("roundtrip-track");
    return raw && JSON.parse(raw).points.length === n;
  }, FIXES + 1, { timeout: 10000 }).catch(() => {});
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("roundtrip-track");
    return raw ? JSON.parse(raw).points.length : 0;
  });
  t.ok("Aufzeichnung landet von selbst im Speicher", stored === FIXES + 1, stored + " Punkte");

  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => typeof track !== "undefined" && track.points.length > 0, { timeout: 20000 });
  const back = await page.evaluate(() => ({
    n: track.points.length, dist: track.distance, rec: track.recording,
    line: !!trackLine, title: document.getElementById("trackTitle").textContent.trim(),
    backRow: getComputedStyle(document.getElementById("backRow")).display
  }));
  t.ok("Aufzeichnung ist nach dem Neuladen wieder da", back.n === FIXES + 1, back.n + " Punkte");
  t.ok("Länge wird korrekt wiederhergestellt",
       Math.abs(back.dist - FIXES * STEP_M) < 25, Math.round(back.dist) + " m");
  t.ok("Eine laufende Aufzeichnung wird fortgesetzt", back.rec && /läuft/.test(back.title));
  t.ok("Hinweg wird wieder gezeichnet", back.line);
  t.ok("Rückweg bleibt einen Knopfdruck entfernt", back.backRow !== "none");

  /* --- Das Maß für „gemeinsame Strecke" --- */
  const metric = await page.evaluate(() => {
    const line = trackCoords();
    const A = line[0], B = line[line.length - 1];
    const off = line.map(c => [c[0] + 0.003, c[1]]);           // gut 300 m daneben
    const half = line.slice(0, Math.ceil(line.length / 2))
      .concat(line.slice(Math.ceil(line.length / 2)).map(c => [c[0] + 0.003, c[1]]));
    // Weg, der nur an den beiden Enden auf den Hinweg trifft und dazwischen
    // 300 m daneben verläuft – genau der Fall, für den es den Freiraum gibt.
    const ends = [A, [A[0] + 0.003, A[1]], [B[0] + 0.003, B[1]], B];
    return {
      same: nearFraction(line, [line], 0, []),
      away: nearFraction(off, [line], 0, []),
      half: nearFraction(half, [line], 0, []),
      endsStrict: nearFraction(ends, [line], 0, []),
      endsFree: nearFraction(ends, [line], 400, [A, B])
    };
  });
  t.ok("Deckungsgleicher Weg gilt vollständig als gemeinsam", metric.same > 0.95, metric.same.toFixed(2));
  t.ok("300 m Abstand gelten als eigener Weg", metric.away < 0.05, metric.away.toFixed(2));
  t.ok("Halb gemeinsam wird auch halb gezählt", Math.abs(metric.half - 0.5) < 0.12, metric.half.toFixed(2));
  t.ok("Ohne Freiraum zählen auch die Enden mit", metric.endsStrict > 0.03, metric.endsStrict.toFixed(3));
  t.ok("Der Nahbereich um Start und Ziel bleibt straffrei", metric.endsFree < 0.01,
       metric.endsFree.toFixed(3));

  /* --- Rückweg suchen --- */
  await page.click("#recBtn");                 // Aufzeichnung beenden
  t.ok("Aufzeichnung lässt sich beenden", await page.evaluate(() => !track.recording));
  t.ok("Knopf bietet danach das Fortsetzen an",
       /Weiter/.test(await page.locator("#recBtn").textContent()));

  await page.click("#backBtn");
  await page.waitForFunction(() => !busy && lastRoute, { timeout: long });
  const ret = await page.evaluate(A => {
    const c = lastRoute.coords;
    return {
      kind: lastRoute.kind, shared: lastRoute.shared, dist: lastRoute.distance,
      startsHere: segLen(c[0], [track.points[track.points.length - 1][0], track.points[track.points.length - 1][1]]),
      endsAtStart: segLen(c[c.length - 1], A),
      status: document.getElementById("status").textContent,
      canShare: !document.getElementById("shareBtn").disabled,
      canSave: !document.getElementById("saveBtn").disabled,
      trackStillThere: !!trackLine
    };
  }, A);
  t.ok("Ergebnis ist als Rückweg gekennzeichnet", ret.kind === "return");
  t.ok("Rückweg beginnt am Ende der Aufzeichnung (bis auf die Schnapp-Distanz)",
       ret.startsHere < 150, Math.round(ret.startsHere) + " m");
  t.ok("Rückweg endet am Startpunkt (bis auf die Schnapp-Distanz)",
       ret.endsAtStart < 150, Math.round(ret.endsAtStart) + " m");
  t.ok("Rückweg teilt wenig mit dem Hinweg", ret.shared < 0.2, (ret.shared * 100).toFixed(0) + " % gemeinsam");
  t.ok("Status nennt Länge und gemeinsame Strecke",
       /Rückweg/.test(ret.status) && /gemeinsam/.test(ret.status), ret.status.trim());
  t.ok("Hinweg bleibt neben dem Rückweg sichtbar", ret.trackStillThere);
  t.ok("Teilen und Speichern stehen bereit", ret.canShare && ret.canSave);

  /* Der kürzeste Weg zurück wäre der Hinweg selbst – der Vergleich zeigt,
     dass die Suche tatsächlich ausweicht und nicht bloß zurückroutet. */
  const vsDirect = await page.evaluate(async A => {
    const line = trackCoords();
    const B = line[line.length - 1];
    const direct = await osrmRoute([B, A], "foot");
    return { shared: nearFraction(direct.coords, [line], 80, [B, A]), dist: direct.distance };
  }, A);
  t.ok("Der direkte Rückweg liegt zu großen Teilen auf dem Hinweg", vsDirect.shared > 0.15,
       (vsDirect.shared * 100).toFixed(0) + " % gemeinsam");
  t.ok("Der gefundene Rückweg weicht deutlich davon ab", ret.shared < vsDirect.shared - 0.1,
       `${(ret.shared * 100).toFixed(0)} % statt ${(vsDirect.shared * 100).toFixed(0)} %`);
  t.ok("Der Umweg bleibt im Rahmen", ret.dist < vsDirect.dist * 2.2,
       `${Math.round(ret.dist)} m statt ${Math.round(vsDirect.dist)} m`);

  /* --- Noch ein Vorschlag: muss auch vom ersten Rückweg abweichen --- */
  t.ok("Knopf bietet einen weiteren Vorschlag an",
       /Anderer Rückweg/.test(await page.locator("#backBtn").textContent()));
  const first = await page.evaluate(() => lastRoute.coords.map(c => c.slice()));
  await page.click("#backBtn");
  await page.waitForFunction(n => !busy && lastRoute && lastRoute.coords.length !== n,
                             first.length, { timeout: long }).catch(() => {});
  const second = await page.evaluate(prev => ({
    shared: lastRoute.shared,
    vsFirst: nearFraction(lastRoute.coords, [prev], 80, [prev[0], prev[prev.length - 1]]),
    n: returnRoutes.length
  }), first);
  t.ok("Auch der zweite Vorschlag meidet den Hinweg", second.shared < 0.25,
       (second.shared * 100).toFixed(0) + " % gemeinsam");
  t.ok("Der zweite Vorschlag ist ein anderer Weg", second.vsFirst < 0.7,
       (second.vsFirst * 100).toFixed(0) + " % wie der erste");
  t.ok("Vorschläge werden gesammelt", second.n === 2, second.n + " Rückwege");

  /* --- Warum „Anderer Rückweg" nicht dasselbe liefern darf ---
     Der Plan der Ausweich-Bögen wird gewürfelt, nicht fest abgespult: sonst
     stellt jeder Knopfdruck dieselben Anfragen und liefert zwangsläufig
     denselben Weg. Und der erlaubte Umweg wächst mit jedem Vorschlag, damit
     der größere Bogen überhaupt in Frage kommt. */
  const plan = await page.evaluate(() => {
    const key = p => p.map(s => `${s.side}|${s.f.toFixed(3)}|${s.n}|${s.skew.toFixed(3)}`).join(",");
    const a = returnPlan(1), b = returnPlan(1);
    return {
      differs: key(a) !== key(b),
      sides: new Set(a.map(s => s.side)).size,
      spread: Math.max(...a.map(s => s.f)) / Math.min(...a.map(s => s.f)),
      short0: returnMaxRatio(270, 0), short2: returnMaxRatio(270, 2),
      long0: returnMaxRatio(4000, 0)
    };
  });
  t.ok("Zwei Suchläufe probieren nicht dieselben Bögen", plan.differs);
  t.ok("Beide Seiten des Hinwegs kommen dran", plan.sides === 2);
  t.ok("Die Auslenkungen decken einen weiten Bereich ab", plan.spread > 2.5, plan.spread.toFixed(1) + "×");
  t.ok("Auf kurzer Strecke ist mehr als der eingestellte Prozentsatz erlaubt",
       plan.short0 > 2, plan.short0.toFixed(2) + "×");
  t.ok("Auf langer Strecke bleibt die Einstellung maßgeblich",
       Math.abs(plan.long0 - 1.6) < 0.01, plan.long0.toFixed(2) + "×");
  t.ok("Jeder weitere Vorschlag darf länger ausfallen", plan.short2 > plan.short0 * 1.6,
       `${plan.short0.toFixed(2)}× → ${plan.short2.toFixed(2)}×`);

  /* --- Kurzer Rückweg: der straffreie Nahbereich darf nicht alles schlucken ---
     80 m um Start *und* Ziel decken auf 270 m fast die ganze Strecke ab – dann
     meldet die App „0 % gemeinsam", obwohl sichtbar ein Stück Hinweg
     mitbenutzt wird. Der Freiraum wächst deshalb mit der Entfernung mit. */
  const freeShort = await page.evaluate(() => {
    const A = [52.5145, 13.3501];
    const dLon = 15 / (111320 * Math.cos(A[0] * Math.PI / 180));
    const line = Array.from({ length: 9 }, (_, i) => [A[0], +(A[1] + i * dLon).toFixed(6)]);
    const B = line[line.length - 1];                     // 120 m Luftlinie – wie im Screenshot
    // Rückweg außen herum, der die letzten ~45 m auf dem Hinweg zurücklegt
    const off = line.slice(3).map(c => [c[0] + 0.0015, c[1]]).reverse();
    const ret = [B].concat(off, line.slice(0, 4).reverse());
    const crow = segLen(ret[0], ret[ret.length - 1]);
    const freeR = Math.max(20, Math.min(300, RETURN_FREE_M + 120 * 0.03, crow * 0.2));
    return { freeR, old: nearFraction(ret, [line], RETURN_FREE_M, [B, A]),
             now: nearFraction(ret, [line], freeR, [B, A]) };
  });
  t.ok("Der Freiraum schrumpft auf kurzer Strecke", freeShort.freeR < 80,
       Math.round(freeShort.freeR) + " m statt 80 m");
  t.ok("Kurzer Rückweg meldet den mitbenutzten Hinweg nicht länger als 0 %",
       freeShort.old < 0.05 && freeShort.now > 0.1,
       `${(freeShort.old * 100).toFixed(0)} % → ${(freeShort.now * 100).toFixed(0)} %`);

  /* --- Wenn das Wegenetz wirklich nichts anderes hergibt --- */
  const stuck = await page.evaluate(async () => {
    const line = trackCoords();
    const from = line[line.length - 1], to = line[0];
    const real = osrmRoute;
    const fixed = await real([from, to], "foot");
    // Router, der auf jede Anfrage denselben Weg liefert – wie ein Wohngebiet,
    // aus dem nur eine einzige Straße herausführt.
    osrmRoute = async () => ({ ...fixed, coords: fixed.coords.map(c => c.slice()) });
    try {
      returnRoutes = []; returnBase = null;
      const one = await searchReturn(from, to, "foot", () => {}, () => false);
      returnRoutes = [one.cand.coords];
      const two = await searchReturn(from, to, "foot", () => {}, () => false);
      return { firstFresh: one.fresh, secondFresh: two.fresh, prev: two.cand.prev,
               reqOne: one.requests, reqTwo: two.requests };
    } finally { osrmRoute = real; returnRoutes = []; returnBase = null; }
  });
  t.ok("Der erste Vorschlag gilt als neuer Weg", stuck.firstFresh === true);
  t.ok("Ein wiederholter Weg wird als solcher erkannt", stuck.prev > 0.9,
       (stuck.prev * 100).toFixed(0) + " % wie zuvor");
  t.ok("Und nicht als neuer Vorschlag ausgegeben", stuck.secondFresh === false);
  t.ok("Der Maßstab wird nicht bei jedem Druck neu angefragt", stuck.reqTwo < stuck.reqOne,
       `${stuck.reqOne} → ${stuck.reqTwo} Anfragen`);

  /* --- Speichern: ein Rückweg ist kein Rundkurs --- */
  await page.evaluate(() => { savedRoutes = []; persistRoutes(); });
  await page.click("#saveBtn");
  await page.waitForFunction(() => savedRoutes.length === 1, { timeout: long });
  const saved = await page.evaluate(() => savedRoutes[0]);
  t.ok("Rückweg wird als solcher gespeichert", saved.kind === "return" && saved.targetKm === 0);
  t.ok("Name weist den Rückweg aus", /↩️/.test(saved.name), saved.name);
  await page.click("#routesBtn");
  t.ok("Routenliste kennzeichnet Rückwege",
       /Rückweg/.test(await page.locator(".routeItem .rmeta").first().textContent()));
  await page.click("#routesClose");

  /* --- Wer schon fast da ist, braucht keinen Rückweg --- */
  await page.evaluate(() => {
    const now = Date.now();
    track = { points: [[52.5145, 13.3501, now], [52.51458, 13.35025, now + 1000],
                       [52.51452, 13.35012, now + 2000]],
              distance: 220, recording: false, startedAt: now, mode: "foot" };
    returnRoutes = [];
    renderTrack(); renderTrackUI();
  });
  await page.click("#backBtn");
  await page.waitForTimeout(200);
  const near = await page.evaluate(() => document.getElementById("status").textContent);
  t.ok("Kurzer Abstand zum Start wird erklärt statt geroutet", /Luftlinie/.test(near), near.trim());

  /* --- Verwerfen --- */
  await page.click("#trackDelBtn");
  await page.waitForTimeout(200);
  const gone = await page.evaluate(() => ({
    n: track.points.length, line: !!trackLine, dest: !!trackDestMarker,
    stored: localStorage.getItem("roundtrip-track"),
    back: getComputedStyle(document.getElementById("backRow")).display,
    del: getComputedStyle(document.getElementById("trackDelBtn")).display
  }));
  t.ok("Verwerfen löscht die Aufzeichnung", gone.n === 0 && !gone.line && !gone.dest);
  t.ok("Auch aus dem Speicher", gone.stored === null);
  t.ok("Die Knöpfe verschwinden wieder", gone.back === "none" && gone.del === "none");

  t.ok("Keine JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
  return t;
};
