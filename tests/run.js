#!/usr/bin/env node
/* Führt alle Test-Suiten aus.
     node tests/run.js              alle Suiten, ohne Netz (synthetische Antworten)
     node tests/run.js ui core      nur einzelne Suiten
     LIVE=1 node tests/run.js       gegen die echten Dienste (OSRM, Open-Meteo)
   Rückgabewert 0 = alles bestanden, 1 = mindestens eine Prüfung gescheitert. */

const { launch, LIVE } = require("./harness");

const SUITES = {
  core: "./core.test.js",
  ui: "./ui.test.js",
  elevation: "./elevation.test.js",
  layout: "./layout.test.js"
};

(async () => {
  const wanted = process.argv.slice(2).filter(a => SUITES[a]);
  const names = wanted.length ? wanted : Object.keys(SUITES);
  console.log(`Roundtrip-Tests · ${names.length} Suite(n) · ${LIVE ? "LIVE (echte Dienste)" : "ohne Netz"}\n`);

  const env = await launch();
  let failed = 0, total = 0;
  const started = Date.now();
  try {
    for (const name of names) {
      const suiteRun = require(SUITES[name]);
      const t = await suiteRun(env);
      console.log(`${name}:`);
      failed += t.report();
      total += t.results.length;
      console.log("");
    }
  } catch (e) {
    console.error("Testlauf abgebrochen:", e && e.stack || e);
    failed++;
  } finally {
    if (!LIVE && env.unstubbed.length)
      console.log("⚠ nicht abgedeckte Adressen (tests/stub.js ergänzen):\n  " +
                  [...new Set(env.unstubbed)].join("\n  ") + "\n");
    await env.close();
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${total - failed}/${total} Prüfungen bestanden in ${secs} s`);
  process.exit(failed ? 1 : 0);
})();
