/* Prüft die reinen Rechenfunktionen der App im Browser-Kontext:
   Kodierung des Teilen-Links, Linien-Vereinfachung, Abtastung, Höhen-Statistik
   sowie die Metriken für Doppelstrecken und Rundheit. */

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Rechenkern");
  const page = await env.newPage();
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  /* --- Kodierung für den Teilen-Link --- */
  const enc = await page.evaluate(() => {
    const orig = [];
    for (let i = 0; i < 400; i++)
      orig.push([52.5 + Math.sin(i / 9) * 0.01 + i * 1e-4, 13.4 + Math.cos(i / 7) * 0.013]);
    const s = encodePath(orig);
    const back = decodePath(s);
    let maxErr = 0;
    for (let i = 0; i < orig.length; i++)
      maxErr = Math.max(maxErr, segLen(orig[i], back[i]));
    return { len: s.length, n: back.length, maxErr, alphabetOk: /^[A-Za-z0-9_-]+$/.test(s) };
  });
  t.ok("Kodierung liefert nur URL-sichere Zeichen", enc.alphabetOk);
  t.ok("Punktzahl bleibt erhalten", enc.n === 400, enc.n + " Punkte");
  t.ok("Rundungsfehler unter 1,5 m", enc.maxErr < 1.5, enc.maxErr.toFixed(2) + " m");
  t.ok("Kodierung ist kompakt", enc.len < 400 * 9, enc.len + " Zeichen für 400 Punkte");

  const edge = await page.evaluate(() => {
    const pts = [[-33.86785, 151.20732], [0, 0], [51.5, -0.1], [-0.00001, 179.99999]];
    const back = decodePath(encodePath(pts));
    return pts.map((p, i) => segLen(p, back[i])).every(d => d < 1.5);
  });
  t.ok("Auch Süd-/Westhalbkugel und Datumsgrenze", edge);

  /* --- Douglas-Peucker --- */
  const simp = await page.evaluate(() => {
    const orig = [];
    for (let i = 0; i <= 600; i++)
      orig.push([52.5 + i * 2e-5 + Math.sin(i / 3) * 2e-5, 13.4 + Math.sin(i / 40) * 0.004]);
    const out = simplifyPath(orig, 4);
    // größte Abweichung der Originalpunkte von der vereinfachten Linie
    const kx = Math.cos(52.5 * Math.PI / 180) * 111320, ky = 110540;
    const P = c => [c[1] * kx, c[0] * ky];
    let maxDev = 0;
    for (const o of orig) {
      const p = P(o);
      let best = Infinity;
      for (let i = 1; i < out.length; i++) {
        const a = P(out[i - 1]), b = P(out[i]);
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const tt = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        const ex = a[0] + dx * tt - p[0], ey = a[1] + dy * tt - p[1];
        best = Math.min(best, Math.sqrt(ex * ex + ey * ey));
      }
      maxDev = Math.max(maxDev, best);
    }
    return { from: orig.length, to: out.length, maxDev,
             endsKept: out[0][0] === orig[0][0] && out[out.length - 1][0] === orig[orig.length - 1][0] };
  });
  t.ok("Vereinfachung spart Punkte", simp.to < simp.from * 0.5, `${simp.from} → ${simp.to}`);
  t.ok("Abweichung bleibt in der Toleranz", simp.maxDev <= 4.01, simp.maxDev.toFixed(2) + " m ≤ 4 m");
  t.ok("Anfang und Ende bleiben unverändert", simp.endsKept);

  /* --- Abtastung entlang der Route --- */
  const sa = await page.evaluate(() => {
    const coords = [[52.50, 13.40], [52.51, 13.40], [52.51, 13.41], [52.50, 13.40]];
    const { pts, total } = sampleAlong(coords, 100);
    let monotonic = true;
    for (let i = 1; i < pts.length; i++) if (pts[i].pos < pts[i - 1].pos) monotonic = false;
    const gaps = pts.slice(1).map((p, i) => p.pos - pts[i].pos);
    return { n: pts.length, monotonic, total,
             firstOk: Math.abs(pts[0].lat - 52.50) < 1e-9,
             lastOk: Math.abs(pts[99].pos - total) < 1,
             even: Math.max(...gaps) - Math.min(...gaps) < 1 };
  });
  t.ok("Genau 100 Stützpunkte", sa.n === 100);
  t.ok("Abstände sind gleichmäßig", sa.even);
  t.ok("Positionen laufen monoton", sa.monotonic);
  t.ok("Erster Punkt ist der Start", sa.firstOk);
  t.ok("Letzter Punkt ist das Ende", sa.lastOk);

  /* --- Höhen-Statistik: Glättung gegen das Rauschen des Höhenmodells ---
     Der entscheidende Fall: eine flache Runde darf keine Höhenmeter erfinden,
     ein echter Hügel muss trotz Rauschen vollständig gezählt werden. */
  const st = await page.evaluate(() => {
    const view = e => elevStats(smoothElev(e));
    const zig = [];        // ±2 m Zickzack (Sprünge von 4 m) auf flachem Gelände
    for (let i = 0; i < 100; i++) zig.push({ d: i * 30, e: 100 + (i % 2 ? 2 : -2) });
    // Rasterrauschen wie beim echten Dienst: ganzzahlige Werte, ±3 m Streuung
    const noise = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 100; i++) noise.push({ d: i * 30, e: Math.round(100 + (rnd() - 0.5) * 6) });
    // derselbe Rauschpegel, aber über einem echten Hügel von 60 m
    const hill = [];
    seed = 7;
    for (let i = 0; i < 100; i++) {
      const real = 100 + 60 * Math.sin(Math.PI * i / 99);
      hill.push({ d: i * 30, e: Math.round(real + (rnd() - 0.5) * 6) });
    }
    const ramp = [];
    for (let i = 0; i < 40; i++) ramp.push({ d: i * 30, e: 100 + i * 2.5 });   // +97,5 m
    const loop = [];
    for (let i = 0; i < 41; i++) loop.push({ d: i * 60, e: 100 + (i <= 20 ? i * 4 : (40 - i) * 4) });
    return { zig: view(zig), noise: view(noise), hill: view(hill),
             ramp: view(ramp), loop: view(loop), rawNoise: elevStats(noise) };
  });
  t.ok("Zickzack erzeugt keine Höhenmeter", st.zig.asc === 0 && st.zig.desc === 0,
       `↑ ${st.zig.asc.toFixed(1)} ↓ ${st.zig.desc.toFixed(1)}`);
  t.ok("Rasterrauschen bleibt nahe null", st.noise.asc < 15,
       `↑ ${st.noise.asc.toFixed(0)} hm (ungeglättet wären es ${st.rawNoise.asc.toFixed(0)})`);
  t.ok("Glättung wirkt überhaupt", st.rawNoise.asc > st.noise.asc * 4,
       `${st.rawNoise.asc.toFixed(0)} → ${st.noise.asc.toFixed(0)} hm`);
  t.ok("Echter Hügel wird trotz Rauschen gezählt", st.hill.asc > 50 && st.hill.asc < 75,
       `↑ ${st.hill.asc.toFixed(0)} hm bei 60 m Hügel`);
  t.ok("Gleichmäßiger Anstieg wird korrekt summiert", Math.abs(st.ramp.asc - 97.5) < 6,
       `↑ ${st.ramp.asc.toFixed(1)} von 97,5`);
  t.ok("Rundkurs: Anstieg = Abstieg", Math.abs(st.loop.asc - st.loop.desc) < 1,
       `↑ ${st.loop.asc.toFixed(0)} ↓ ${st.loop.desc.toFixed(0)}`);
  t.ok("Höhenbereich wird erfasst", st.loop.min < 105 && st.loop.max > 170,
       `${st.loop.min.toFixed(0)}–${st.loop.max.toFixed(0)} m`);

  /* --- Metriken: Doppelstrecke und Rundheit --- */
  const met = await page.evaluate(() => {
    const there = [], back = [];
    for (let i = 0; i <= 100; i++) there.push([52.5 + i * 1e-4, 13.4]);
    for (let i = 100; i >= 0; i--) back.push([52.5 + i * 1e-4, 13.4]);
    const outAndBack = there.concat(back.slice(1));
    const circle = [];
    for (let a = 0; a <= 360; a += 3) {
      const r = 0.005;
      circle.push([52.5 + r * Math.cos(a * Math.PI / 180), 13.4 + r * Math.sin(a * Math.PI / 180) / Math.cos(52.5 * Math.PI / 180)]);
    }
    return {
      obOverlap: overlapFraction(outAndBack), obRound: roundness(outAndBack),
      cOverlap: overlapFraction(circle), cRound: roundness(circle),
      pinch: !!findWorstPinch(outAndBack)
    };
  });
  t.ok("Hin und zurück gilt als Doppelstrecke", met.obOverlap > 0.7, (met.obOverlap * 100).toFixed(0) + " %");
  t.ok("Rundkurs gilt nicht als Doppelstrecke", met.cOverlap < 0.05, (met.cOverlap * 100).toFixed(1) + " %");
  t.ok("Kreis erreicht hohe Rundheit", met.cRound > 0.9, met.cRound.toFixed(2));
  t.ok("Stichweg erreicht keine Rundheit", met.obRound < 0.05, met.obRound.toFixed(3));
  t.ok("Zipfel wird geometrisch erkannt", met.pinch);

  /* --- Anzeigeformate --- */
  const fmt = await page.evaluate(() => ({
    m: fmtDist(742), km: fmtDist(5123), min: fmtDur(1500), h: fmtDur(5400),
    foot: modeMeta("foot").label, bike: modeMeta("bike").label, unknown: modeMeta("xxx").label
  }));
  t.ok("Kurze Strecken in Metern", fmt.m === "742 m", fmt.m);
  t.ok("Lange Strecken in Kilometern", fmt.km === "5,12 km", fmt.km);
  t.ok("Dauer unter einer Stunde", fmt.min === "25 min", fmt.min);
  t.ok("Dauer über einer Stunde", fmt.h === "1 h 30 min", fmt.h);
  t.ok("Verkehrsmittel-Tabelle greift", fmt.bike === "Fahrrad" && fmt.unknown === "zu Fuß");

  t.ok("Keine JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
  return t;
};
