/* Einstiegstour: Erscheint sie beim ersten Öffnen – und nur dann? Sitzt das
   Loch im Dunkel über dem erklärten Bereich? Kommen die Einzelhinweise erst,
   wenn es etwas zu erklären gibt? */

const START = [52.5145, 13.3501];

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Einstiegstour");

  /* --- Erster Besuch --- */
  const page = await env.newPage({ tour: true });
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  await page.waitForSelector("#tour.show", { timeout: 10000 });
  t.ok("Beim ersten Öffnen startet die Tour", await page.locator("#tour.show").count() === 1);

  const first = await page.evaluate(() => ({
    title: document.getElementById("tourTitle").textContent,
    dots: document.querySelectorAll("#tourDots i").length,
    on: document.querySelectorAll("#tourDots i.on").length,
    back: getComputedStyle(document.getElementById("tourBack")).display,
    next: document.getElementById("tourNext").textContent,
    focused: document.activeElement && document.activeElement.id,
    steps: TOUR_STEPS.length
  }));
  t.ok("Fünf Schritte, nicht mehr", first.steps === 5 && first.dots === 5, first.steps + " Schritte");
  t.ok("Der erste ist markiert", first.on === 1);
  t.ok("Im ersten Schritt gibt es kein Zurück", first.back === "none");
  t.ok("Der Fokus liegt auf „Weiter“", first.focused === "tourNext", first.focused);
  t.ok("Die Tour beginnt beim Startpunkt", /Wo geht es los/.test(first.title), first.title);

  /* Das Loch muss über dem erklärten Bereich liegen – sonst zeigt die Tour
     ins Leere und niemand merkt es. */
  const fits = async () => page.evaluate(() => {
    const step = TOUR_STEPS[tourIdx];
    const el = document.getElementById(step.el).getBoundingClientRect();
    const hole = document.getElementById("tourHole").getBoundingClientRect();
    const bub = document.getElementById("tourBubble").getBoundingClientRect();
    return {
      el: step.el,
      covers: hole.left <= el.left + 1 && hole.top <= el.top + 1 &&
              hole.right >= el.right - 1 && hole.bottom >= el.bottom - 1,
      tight: hole.width - el.width < 24 && hole.height - el.height < 24,
      bubbleIn: bub.left >= 0 && bub.top >= 0 &&
                bub.right <= window.innerWidth + 1 && bub.bottom <= window.innerHeight + 1,
      overlaps: !(bub.right < hole.left || bub.left > hole.right ||
                  bub.bottom < hole.top || bub.top > hole.bottom)
    };
  });

  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(await fits());
    if (i < 4) { await page.click("#tourNext"); await page.waitForTimeout(340); }
  }
  t.ok("Jeder Schritt hebt seinen Bereich hervor", seen.every(s => s.covers),
       seen.filter(s => !s.covers).map(s => s.el).join(", ") || "alle fünf");
  t.ok("Der Rahmen sitzt eng am Element", seen.every(s => s.tight));
  t.ok("Die Sprechblase bleibt im Bild", seen.every(s => s.bubbleIn));
  t.ok("Und verdeckt nie, was sie erklärt", seen.every(s => !s.overlaps));
  t.ok("Der letzte Schritt schließt ab",
       /Fertig/.test(await page.locator("#tourNext").textContent()));
  t.ok("Die Tour erklärt den Höhenwunsch", seen.some(s => s.el === "climbBtn"));
  t.ok("Und den Rückweg", seen.some(s => s.el === "trackBox"));

  await page.click("#tourNext");
  const done = await page.evaluate(() => ({
    show: document.getElementById("tour").classList.contains("show"),
    hidden: document.getElementById("tour").getAttribute("aria-hidden"),
    stored: JSON.parse(localStorage.getItem("roundtrip-tour"))
  }));
  t.ok("Am Ende ist das Overlay weg", !done.show && done.hidden === "true");
  t.ok("Und der Besuch ist vermerkt", done.stored && done.stored.done === true);
  t.ok("Nicht als übersprungen", done.stored && !done.stored.skipped);

  /* --- Hinweise kommen erst, wenn es etwas zu sehen gibt --- */
  await page.evaluate(s => { map.setView(s, 15); setStart(L.latLng(s[0], s[1]), false); }, START);
  await page.fill("#distInput", "3");
  await page.click("#genBtn");
  await page.waitForFunction(() => !busy && lastRoute, { timeout: 60000 });
  await page.waitForSelector("#tour.show", { timeout: 30000 });
  const mark = await page.evaluate(() => ({
    title: document.getElementById("tourTitle").textContent,
    next: document.getElementById("tourNext").textContent,
    dots: document.querySelectorAll("#tourDots i").length,
    skip: getComputedStyle(document.getElementById("tourSkip")).display
  }));
  t.ok("Das Höhenprofil wird erklärt, sobald es da ist", /Höhenprofil/.test(mark.title), mark.title);
  t.ok("Ein Einzelhinweis hat keine Schrittpunkte", mark.dots === 0);
  t.ok("Und kein Überspringen", mark.skip === "none");
  t.ok("Er schließt mit „Alles klar“", /Alles klar/.test(mark.next), mark.next);

  await page.click("#tourNext");
  await page.waitForFunction(() => variants.length >= 2, { timeout: 60000 }).catch(() => {});
  await page.waitForSelector("#tour.show", { timeout: 30000 }).catch(() => {});
  const second = await page.evaluate(() => ({
    title: document.getElementById("tourTitle").textContent,
    show: document.getElementById("tour").classList.contains("show"),
    n: variants.length
  }));
  t.ok("Die Varianten werden erklärt, sobald es zwei gibt",
       second.n < 2 || (second.show && /Vorschläge/.test(second.title)), second.title);
  await page.evaluate(() => tourEnd());
  const sharedUrl = await page.evaluate(() => shareUrl(lastRoute));   // echter Teilen-Link

  const seenBoth = await page.evaluate(() => JSON.parse(localStorage.getItem("roundtrip-tour")).seen);
  t.ok("Beide Hinweise sind vermerkt", seenBoth.elev === true && seenBoth.variants === true,
       JSON.stringify(seenBoth));

  /* --- Zweiter Besuch: Ruhe --- */
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  await page.waitForTimeout(1100);
  t.ok("Beim zweiten Öffnen bleibt alles still",
       await page.locator("#tour.show").count() === 0);
  t.ok("Ein gesehener Hinweis kommt nicht wieder", await page.evaluate(() => {
    tourMark("elev");
    return !document.getElementById("tour").classList.contains("show");
  }));

  /* Aus den Einstellungen lässt sie sich zurückholen */
  await page.click("#gearBtn");
  await page.click("#tourAgainBtn");
  await page.waitForSelector("#tour.show", { timeout: 5000 });
  t.ok("Die Einstellungen holen die Tour zurück", await page.locator("#tour.show").count() === 1);
  t.ok("Das Einstellungsfenster schließt dabei",
       await page.evaluate(() => getComputedStyle(document.getElementById("modalBg")).display === "none"));
  await page.keyboard.press("Escape");
  const skipped = await page.evaluate(() => ({
    show: document.getElementById("tour").classList.contains("show"),
    stored: JSON.parse(localStorage.getItem("roundtrip-tour"))
  }));
  t.ok("Esc bricht ab", !skipped.show);
  t.ok("Ein Abbruch wird als solcher vermerkt", skipped.stored.skipped === true);
  t.ok("Nach dem Abbruch kommen auch keine Hinweise mehr", await page.evaluate(() => {
    tourState.seen = {};
    tourMark("variants");
    return !document.getElementById("tour").classList.contains("show");
  }));
  t.ok("Keine JS-Fehler", page.errors.length === 0, page.errors.join(" | "));
  await page.close();

  /* --- Geteilter Link: die Route, kein Kurs --- */
  const shared = await env.newPage({ tour: true });
  await shared.goto(sharedUrl, { waitUntil: "load" });
  await shared.waitForFunction(() => typeof window.L !== "undefined" && lastRoute, { timeout: 20000 });
  await shared.waitForTimeout(1100);
  t.ok("Wer über einen Link kommt, bekommt keine Tour",
       await shared.locator("#tour.show").count() === 0);
  t.ok("Und auch keine Einzelhinweise", await shared.evaluate(() => {
    tourMark("elev");
    return !document.getElementById("tour").classList.contains("show");
  }));
  t.ok("Der Besuch wird nicht als erledigt abgehakt", await shared.evaluate(() =>
    !JSON.parse(localStorage.getItem("roundtrip-tour") || "{}").done));
  t.ok("Die geteilte Route ist trotzdem da", await shared.evaluate(() => !!lastRoute));
  await shared.close();

  /* --- Schmales Handy: passt das Overlay auch da? --- */
  const phone = await env.newPage({ tour: true, viewport: { width: 360, height: 720 } });
  await phone.goto(env.url, { waitUntil: "load" });
  await phone.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  await phone.waitForSelector("#tour.show", { timeout: 10000 });
  const small = [];
  for (let i = 0; i < 5; i++) {
    small.push(await phone.evaluate(() => {
      const el = document.getElementById(TOUR_STEPS[tourIdx].el).getBoundingClientRect();
      const hole = document.getElementById("tourHole").getBoundingClientRect();
      const bub = document.getElementById("tourBubble").getBoundingClientRect();
      return { step: TOUR_STEPS[tourIdx].el,
               covers: hole.left <= el.left + 1 && hole.right >= el.right - 1,
               inView: bub.left >= 0 && bub.top >= 0 &&
                       bub.right <= window.innerWidth + 1 && bub.bottom <= window.innerHeight + 1 };
    }));
    if (i < 4) { await phone.click("#tourNext"); await phone.waitForTimeout(340); }
  }
  t.ok("Auch auf 360 px sitzt jeder Rahmen richtig", small.every(s => s.covers),
       small.filter(s => !s.covers).map(s => s.step).join(", ") || "alle fünf");
  t.ok("Auch auf 360 px bleibt die Sprechblase im Bild", small.every(s => s.inView),
       small.filter(s => !s.inView).map(s => s.step).join(", ") || "alle fünf");
  t.ok("Keine JS-Fehler auf dem Handy", phone.errors.length === 0, phone.errors.join(" | "));
  await phone.close();

  return t;
};
