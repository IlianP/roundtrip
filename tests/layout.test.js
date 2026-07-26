/* Platzabhängige Beschriftung: Text nur, wenn er ohne Umbruch passt.
   Geprüft über echte Bildschirmbreiten von 320 bis 1280 px. */

const WIDTHS = [320, 360, 390, 412, 430, 480, 640, 641, 768, 834, 1024, 1280];

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Platz & Beschriftung");
  const page = await env.newPage();
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  // Eine gespeicherte Route, damit auch die Listen-Buttons prüfbar sind
  await page.evaluate(() => {
    savedRoutes = [{ id: 1, name: "Testroute", createdAt: new Date().toISOString(), mode: "bike",
      targetKm: 5, start: { lat: 52.5, lng: 13.4 }, distance: 5000, duration: 3600,
      coords: [[52.5, 13.4], [52.51, 13.41], [52.5, 13.4]] }];
    persistRoutes();
  });

  const rows = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(140);
    rows.push(await page.evaluate(width => {
      const panel = document.querySelector(".panel");
      const cs = getComputedStyle(panel);
      const inner = panel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const overflowing = [];
      document.querySelectorAll(".btn-row .btn, .seg button").forEach(b => {
        if (b.scrollWidth > b.clientWidth + 1) overflowing.push(b.id || b.textContent.trim());
        if (b.getBoundingClientRect().height > 46) overflowing.push((b.id || "?") + " (umgebrochen)");
      });
      return {
        width, inner: Math.round(inner),
        labels: getComputedStyle(document.querySelector("#saveBtn .lbl")).display !== "none",
        overflowing,
        panelInView: panel.getBoundingClientRect().right <= window.innerWidth + 1
      };
    }, w));
  }

  const bad = rows.filter(r => r.overflowing.length);
  t.ok("Keine Beschriftung läuft über oder bricht um", bad.length === 0,
       bad.map(r => `${r.width}px: ${r.overflowing.join(", ")}`).join(" | "));
  t.ok("Panel bleibt überall im Bild", rows.every(r => r.panelInView));

  const wide = rows.filter(r => r.inner >= 366);
  const tight = rows.filter(r => r.inner < 366);
  t.ok("Text erscheint, sobald der Platz reicht", wide.every(r => r.labels),
       wide.map(r => r.width).join(", ") + " px");
  t.ok("Symbole allein bei wenig Platz", tight.every(r => !r.labels),
       tight.map(r => r.width).join(", ") + " px");
  t.ok("Desktop und Tablet zeigen Text",
       rows.filter(r => r.width >= 768).every(r => r.labels));
  t.ok("Schmale Handys zeigen nur Symbole",
       rows.filter(r => r.width <= 390).every(r => !r.labels));

  /* Routenliste im schmalen Fenster */
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#routesBtn");
  await page.waitForTimeout(300);
  const list = await page.evaluate(() => {
    const over = [];
    document.querySelectorAll(".routeItem .btn").forEach(b => {
      if (b.scrollWidth > b.clientWidth + 1) over.push(b.textContent.trim());
    });
    return { over, nameHidden: getComputedStyle(document.querySelector("[data-act=rename] .lbl")).display === "none",
             loadVisible: document.querySelector("[data-act=load]").textContent.trim() === "Laden" };
  });
  t.ok("Routenliste läuft nicht über", list.over.length === 0, list.over.join(", "));
  t.ok("Listen-Buttons werden zu Symbolen", list.nameHidden);
  t.ok("„Laden“ behält seinen Text (kein Symbol vorhanden)", list.loadVisible);
  await page.click("#routesClose");

  /* Beschriftungslose Buttons müssen benannt bleiben */
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll(".btn.iconic, .seg button, .routeItem .btn")]
      .every(b => (b.getAttribute("aria-label") || "").length > 2 || b.textContent.trim().length > 2));
  t.ok("Alle Symbol-Buttons haben eine Bezeichnung für Vorlesehilfen", labels);

  t.ok("Keine JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
  return t;
};
