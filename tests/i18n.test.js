/* Sprachen: Erkennt der Browser sie richtig, schlägt die eigene Wahl den
   Browser, wechselt die ganze Oberfläche auf einen Schlag – und ist das
   Wörterbuch vollständig genug, dass eine weitere Sprache nur noch ein
   Eintrag ist? */

const START = [52.5145, 13.3501];

module.exports = async function run(env) {
  const { suite } = require("./harness");
  const t = suite("Sprachen");

  /* --- Wörterbücher: gleiche Schlüssel, gleiche Platzhalter --- */
  const page = await env.newPage();
  await page.goto(env.url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });

  const dict = await page.evaluate(() => {
    const codes = Object.keys(LANGS);
    const keys = new Set();
    for (const c of codes) Object.keys(STR[c] || {}).forEach(k => keys.add(k));
    const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
    const missing = [], differing = [];
    for (const c of codes) {
      if (!STR[c]) { missing.push(c + " (ganz)"); continue; }
      for (const k of keys) if (STR[c][k] === undefined) missing.push(`${c}:${k}`);
    }
    for (const k of keys) {
      const forms = new Set(codes.filter(c => STR[c] && STR[c][k] !== undefined).map(c => ph(STR[c][k])));
      if (forms.size > 1) differing.push(k);
    }
    return { codes, keys: keys.size, missing, differing,
             meta: codes.filter(c => !LANGS[c].label || !LANGS[c].locale || !LANGS[c].geo) };
  });
  t.ok("Jede Sprache kennt jeden Schlüssel", dict.missing.length === 0,
       dict.missing.slice(0, 8).join(", ") || `${dict.codes.length} Sprachen · ${dict.keys} Schlüssel`);
  t.ok("Platzhalter stimmen überein", dict.differing.length === 0, dict.differing.join(", "));
  t.ok("Jede Sprache bringt Name, Zahlenformat und Geocoder-Code mit", dict.meta.length === 0,
       dict.meta.join(", "));

  /* Ein fehlender Schlüssel darf die Seite nicht zerreißen: dann gilt die
     Quellsprache, und erst wenn auch die nichts hat, der Schlüssel selbst. */
  const fallback = await page.evaluate(() => {
    const before = lang;
    delete STR.en["btn.generate"];
    setLang("en", { save: false });
    const shown = document.getElementById("genBtn").textContent;
    const raw = t("gibt.es.nicht");
    STR.en["btn.generate"] = "Create route";
    setLang(before, { save: false });
    return { shown, raw };
  });
  t.ok("Fehlt ein Text, greift die Quellsprache", fallback.shown === "Route erzeugen", fallback.shown);
  t.ok("Fehlt er ganz, steht der Schlüssel da", fallback.raw === "gibt.es.nicht", fallback.raw);

  /* Erkennung ohne Browser-Zutun: Regionen zählen zur Grundsprache, alles
     Unbekannte landet bei der Vorgabe. */
  const detect = await page.evaluate(() => ({
    de: detectLang(["de-AT", "en-US"]),
    deBare: detectLang(["DE"]),
    en: detectLang(["en-GB"]),
    unknown: detectLang(["fr-FR", "it"]),
    empty: detectLang([])
  }));
  t.ok("„de-AT“ ist Deutsch", detect.de === "de", detect.de);
  t.ok("Groß-/Kleinschreibung ist gleichgültig", detect.deBare === "de", detect.deBare);
  t.ok("„en-GB“ ist Englisch", detect.en === "en", detect.en);
  t.ok("Unbekannte Wünsche fallen auf die Vorgabe", detect.unknown === "en", detect.unknown);
  t.ok("Ohne Angabe ebenso", detect.empty === "en", detect.empty);
  await page.close();

  /* --- Deutscher Browser --- */
  const de = await env.newPage({ locale: "de-DE" });
  await de.goto(env.url, { waitUntil: "load" });
  await de.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  const deUi = await de.evaluate(() => ({
    lang, html: document.documentElement.lang, gen: document.getElementById("genBtn").textContent,
    status: document.getElementById("status").textContent
  }));
  t.ok("Deutscher Browser bekommt Deutsch", deUi.lang === "de" && deUi.html === "de", deUi.lang);
  t.ok("Und deutsche Beschriftung", deUi.gen === "Route erzeugen", deUi.gen);
  t.ok("Auch die Statuszeile", /Startpunkt wählen/.test(deUi.status), deUi.status);
  t.ok("Keine JS-Fehler", de.errors.length === 0, de.errors.join(" | "));
  await de.close();

  /* --- Englischer Browser: dieselbe Seite, andere Sprache --- */
  const en = await env.newPage({ locale: "en-US" });
  await en.goto(env.url, { waitUntil: "load" });
  await en.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  const enUi = await en.evaluate(() => ({
    lang, html: document.documentElement.lang, title: document.title,
    gen: document.getElementById("genBtn").textContent,
    dist: document.querySelector('label[for="distInput"]').textContent,
    mode: document.querySelector("#modeFoot .lbl").textContent.trim(),
    placeholder: document.getElementById("searchInput").placeholder,
    status: document.getElementById("status").textContent,
    track: document.getElementById("trackTitle").textContent,
    rec: document.getElementById("recBtn").textContent.trim(),
    climb: document.getElementById("climbBtn").textContent.trim(),
    locate: document.getElementById("locateBtn").title,
    attribution: document.querySelector(".leaflet-control-attribution").textContent
  }));
  t.ok("Englischer Browser bekommt Englisch", enUi.lang === "en" && enUi.html === "en", enUi.lang);
  t.ok("Der Seitentitel wechselt mit", /Loop Route Planner/.test(enUi.title), enUi.title);
  t.ok("Knöpfe sind englisch", enUi.gen === "Create route" && enUi.mode === "Walk",
       `${enUi.gen} · ${enUi.mode}`);
  t.ok("Beschriftungen von Feldern auch", enUi.dist === "Distance (km)", enUi.dist);
  t.ok("Der Platzhalter der Suche ebenso", /Search a start point/.test(enUi.placeholder), enUi.placeholder);
  t.ok("Die Statuszeile ebenso", /Pick a start point/.test(enUi.status), enUi.status);
  t.ok("Von JS gezeichnete Bereiche ebenso",
       /Way back later/.test(enUi.track) && /Record/.test(enUi.rec) && /Climb/.test(enUi.climb),
       `${enUi.track} · ${enUi.rec} · ${enUi.climb}`);
  t.ok("Titel für Vorlesehilfen ebenso", enUi.locate === "Use my own location", enUi.locate);
  t.ok("Auch die Quellenangabe der Karte", /contributors/.test(enUi.attribution), enUi.attribution.trim());
  t.ok("Nirgends deutsche Reste", !/[äöüßÄÖÜ]/.test(await en.evaluate(() =>
         document.querySelector(".panel").textContent + document.getElementById("climbPop").textContent)),
       "Panel und Höhen-Popover");

  /* Zahlen in der Schreibweise der Sprache – und eine ganze Statuszeile, die
     nach dem Wechsel noch einmal entsteht, ohne die Route neu zu rechnen. */
  await en.evaluate(s => { map.setView(s, 15); setStart(L.latLng(s[0], s[1]), false); }, START);
  await en.fill("#distInput", "3");
  await en.click("#genBtn");
  await en.waitForFunction(() => !busy && lastRoute, { timeout: 30000 });
  const enStatus = await en.evaluate(() => ({
    line: document.getElementById("status").textContent,
    num: nfmt(1234.5, 1), dist: fmtDist(1234.5), dur: fmtDur(5400)
  }));
  t.ok("Englische Statuszeile nach einer Route", /target|approx/.test(enStatus.line), enStatus.line);
  t.ok("Englisches Zahlenformat", enStatus.num === "1,234.5" && enStatus.dist === "1.23 km",
       `${enStatus.num} · ${enStatus.dist} · ${enStatus.dur}`);

  const switched = await en.evaluate(() => {
    setLang("de");
    return { lang, status: document.getElementById("status").textContent,
             gen: document.getElementById("genBtn").textContent,
             num: nfmt(1234.5, 1), dist: fmtDist(1234.5),
             stored: JSON.parse(localStorage.getItem("roundtrip-settings")).lang };
  });
  t.ok("Der Wechsel wirkt sofort auf die ganze Zeile",
       /Ziel|ca\./.test(switched.status) && !/target|approx/.test(switched.status), switched.status);
  t.ok("Und auf die Knöpfe", switched.gen === "Route erzeugen", switched.gen);
  t.ok("Deutsches Zahlenformat nach dem Wechsel",
       switched.num === "1.234,5" && switched.dist === "1,23 km",
       `${switched.num} · ${switched.dist}`);
  t.ok("Die Wahl wird gespeichert", switched.stored === "de", String(switched.stored));
  t.ok("Keine JS-Fehler beim Wechsel", en.errors.length === 0, en.errors.join(" | "));
  await en.close();

  /* --- Eigene Wahl schlägt den Browser, auch nach einem Neuladen --- */
  const chosen = await env.newPage({ locale: "en-US", lang: "de" });
  await chosen.goto(env.url, { waitUntil: "load" });
  await chosen.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  const chosenUi = await chosen.evaluate(() => ({
    lang, gen: document.getElementById("genBtn").textContent,
    select: document.getElementById("langInput").value
  }));
  t.ok("Die eigene Wahl überlebt das Neuladen", chosenUi.lang === "de", chosenUi.lang);
  t.ok("Und schlägt den englischen Browser", chosenUi.gen === "Route erzeugen", chosenUi.gen);

  /* Das Menü in den Einstellungen: „Automatisch“ plus jede Sprache aus LANGS */
  await chosen.click("#gearBtn");
  const menu = await chosen.evaluate(() => ({
    value: document.getElementById("langInput").value,
    opts: [...document.querySelectorAll("#langInput option")].map(o => o.value),
    auto: document.querySelector('#langInput option[value="auto"]').textContent,
    label: document.querySelector('label[for="langInput"]').textContent
  }));
  t.ok("Jede Sprache steht im Menü",
       menu.opts.length === dict.codes.length + 1 && dict.codes.every(c => menu.opts.includes(c)),
       menu.opts.join(", "));
  t.ok("Die Wahl steht darin", menu.value === "de", menu.value);
  t.ok("„Automatisch“ nennt, was der Browser wollte", /English/.test(menu.auto), menu.auto);
  t.ok("Das Feld ist in beiden Sprachen beschriftet",
       /Sprache/.test(menu.label) && /Language/.test(menu.label), menu.label);

  /* Zurück auf „Automatisch“: der Browser entscheidet wieder */
  const auto = await chosen.evaluate(() => {
    const sel = document.getElementById("langInput");
    sel.value = "auto"; sel.onchange();
    document.getElementById("modalSave").click();
    return { lang, gen: document.getElementById("genBtn").textContent,
             stored: JSON.parse(localStorage.getItem("roundtrip-settings")).lang };
  });
  t.ok("„Automatisch“ gibt dem Browser das Wort zurück", auto.lang === "en", auto.lang);
  t.ok("Und beschriftet neu", auto.gen === "Create route", auto.gen);
  t.ok("Gespeichert wird dabei keine Sprache", auto.stored === null, String(auto.stored));
  t.ok("Keine JS-Fehler", chosen.errors.length === 0, chosen.errors.join(" | "));
  await chosen.close();

  /* --- Erste Tour: Sprachwahl im ersten Schritt --- */
  const tour = await env.newPage({ tour: true, locale: "en-US" });
  await tour.goto(env.url, { waitUntil: "load" });
  await tour.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  await tour.waitForSelector("#tour.show", { timeout: 10000 });
  const first = await tour.evaluate(() => ({
    shown: !document.getElementById("tourLang").hidden,
    opts: [...document.querySelectorAll(".tourLangOpt")].map(b => b.textContent),
    on: [...document.querySelectorAll(".tourLangOpt.on")].map(b => b.textContent),
    title: document.getElementById("tourTitle").textContent,
    next: document.getElementById("tourNext").textContent
  }));
  t.ok("Die erste Tour bietet die Sprachwahl an", first.shown);
  t.ok("Mit jeder Sprache aus LANGS", first.opts.length === dict.codes.length, first.opts.join(" · "));
  t.ok("Die erkannte ist markiert", first.on.length === 1 && first.on[0] === "English", first.on.join(","));
  t.ok("Die Tour spricht sie auch", /Where do we start/.test(first.title), first.title);
  t.ok("Und ihre Knöpfe", first.next === "Next", first.next);

  /* Umschalten mitten im ersten Schritt: Tour und App wechseln zusammen */
  const clicked = await tour.evaluate(() => {
    [...document.querySelectorAll(".tourLangOpt")].find(b => b.textContent === "Deutsch").click();
    return { lang, title: document.getElementById("tourTitle").textContent,
             text: document.getElementById("tourText").textContent,
             next: document.getElementById("tourNext").textContent,
             skip: document.getElementById("tourSkip").textContent,
             on: [...document.querySelectorAll(".tourLangOpt.on")].map(b => b.textContent),
             gen: document.getElementById("genBtn").textContent,
             stored: JSON.parse(localStorage.getItem("roundtrip-settings")).lang,
             shown: !document.getElementById("tourLang").hidden };
  });
  t.ok("Die Wahl in der Tour schaltet sofort um", clicked.lang === "de", clicked.lang);
  t.ok("Überschrift und Text wechseln mit",
       /Wo geht es los/.test(clicked.title) && /Adresse eingeben/.test(clicked.text), clicked.title);
  t.ok("Die Knöpfe der Tour auch", clicked.next === "Weiter" && clicked.skip === "Überspringen",
       `${clicked.next} · ${clicked.skip}`);
  t.ok("Die Markierung folgt", clicked.on.length === 1 && clicked.on[0] === "Deutsch", clicked.on.join(","));
  t.ok("Die App dahinter ebenso", clicked.gen === "Route erzeugen", clicked.gen);
  t.ok("Und die Wahl ist gespeichert", clicked.stored === "de", String(clicked.stored));
  t.ok("Die Wahl bleibt im ersten Schritt sichtbar", clicked.shown);

  /* Ab dem zweiten Schritt ist sie weg – und kommt auch bei der wiederholten
     Tour aus den Einstellungen nicht zurück. */
  await tour.click("#tourNext");
  await tour.waitForTimeout(340);
  t.ok("Im zweiten Schritt ist sie fort", await tour.evaluate(() =>
       document.getElementById("tourLang").hidden));
  await tour.evaluate(() => { tourEnd(); });
  await tour.evaluate(() => { document.getElementById("gearBtn").click();
                              document.getElementById("tourAgainBtn").click(); });
  await tour.waitForSelector("#tour.show", { timeout: 10000 });
  t.ok("Die wiederholte Tour zeigt sie nicht mehr", await tour.evaluate(() =>
       document.getElementById("tourLang").hidden && tourIdx === 0));
  t.ok("Keine JS-Fehler in der Tour", tour.errors.length === 0, tour.errors.join(" | "));
  await tour.close();

  /* --- Platz: englische Beschriftungen sind andere Wörter --- */
  const fit = await env.newPage({ locale: "en-US", viewport: { width: 412, height: 800 } });
  await fit.goto(env.url, { waitUntil: "load" });
  await fit.waitForFunction(() => typeof window.L !== "undefined", { timeout: 20000 });
  const over = [];
  for (const w of [320, 390, 412, 480, 768, 1280]) {
    await fit.setViewportSize({ width: w, height: 800 });
    await fit.waitForTimeout(140);
    const bad = await fit.evaluate(() => {
      const out = [];
      document.querySelectorAll(".btn-row .btn, .seg button").forEach(b => {
        if (!b.clientWidth) return;
        if (b.scrollWidth > b.clientWidth + 1) out.push(b.id || b.textContent.trim());
        if (b.getBoundingClientRect().height > 46) out.push((b.id || "?") + " (umgebrochen)");
      });
      const panel = document.querySelector(".panel");
      if (panel.scrollWidth > panel.clientWidth + 1) out.push("Panel");
      return out;
    });
    if (bad.length) over.push(`${w}px: ${bad.join(", ")}`);
  }
  t.ok("Englische Beschriftungen passen von 320 bis 1280 px", over.length === 0, over.join(" | "));
  t.ok("Keine JS-Fehler", fit.errors.length === 0, fit.errors.join(" | "));
  await fit.close();

  return t;
};
