/* Gemeinsame Grundlage aller Test-Suiten: Webserver, Browser, Netz-Abfang.

   Standard: alle externen Adressen werden aus tests/stub.js beantwortet.
   Mit LIVE=1 gehen Routing-, Höhen- und Geocoding-Anfragen an die echten
   Dienste (per curl, damit der Browser im Container keine eigene
   Zertifikatskette braucht).

   Leaflet wird einmal nach tests/.cache geladen und von dort ausgeliefert –
   so läuft der Browser vollständig ohne Netzzugang. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { respond } = require("./stub");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(__dirname, ".cache");
const LIVE = process.env.LIVE === "1";
const LEAFLET = {
  "leaflet.js": "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "leaflet.css": "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"
};

function curl(url) {
  return new Promise((res, rej) => execFile("curl", ["-sSL", "--max-time", "40", "-H", "Accept-Language: de", url],
    { maxBuffer: 64 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(out)));
}

async function ensureLeaflet() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [file, url] of Object.entries(LEAFLET)) {
    const dest = path.join(CACHE, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    process.stdout.write(`· lade ${file} …\n`);
    fs.writeFileSync(dest, await curl(url));
  }
}

/* Winziger statischer Server für index.html */
function startServer() {
  const server = http.createServer((req, res) => {
    const file = req.url === "/" || req.url.startsWith("/index.html") ? "index.html" : req.url.slice(1).split("?")[0];
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end("not found");
    }
    const type = full.endsWith(".css") ? "text/css" : full.endsWith(".js") ? "application/javascript" : "text/html";
    res.writeHead(200, { "content-type": type + "; charset=utf-8" });
    res.end(fs.readFileSync(full));
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

async function launch() {
  const { chromium } = require("playwright");
  await ensureLeaflet();
  const { server, port } = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const state = { browser, server, port, url: `http://127.0.0.1:${port}/index.html`, unstubbed: [], requests: [] };

  state.newPage = async (opts = {}) => {
    const page = await browser.newPage({ viewport: opts.viewport || { width: 1000, height: 780 } });
    page.errors = [];
    page.on("pageerror", e => page.errors.push("PAGEERROR: " + e.message));
    page.on("console", m => {
      // Das fehlende Favicon ist kein Anwendungsfehler
      if (m.type() === "error" && !/favicon/.test(m.location().url || "")) page.errors.push("CONSOLE: " + m.text());
    });

    await page.route("**/*", async route => {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${port}`)) return route.continue();
      state.requests.push(url);

      const local = Object.keys(LEAFLET).find(f => url.includes(f.replace(".js", ".min.js").replace(".css", ".min.css")));
      if (local) return route.fulfill({
        contentType: local.endsWith("css") ? "text/css" : "application/javascript",
        body: fs.readFileSync(path.join(CACHE, local))
      });

      if (!LIVE) {
        const stub = respond(url);
        if (stub) return route.fulfill(stub);
        state.unstubbed.push(url);
        return route.fulfill({ status: 502, body: "nicht abgedeckt: " + url });
      }
      try {
        if (url.includes("tile.openstreetmap.org")) return route.fulfill(respond(url));
        return route.fulfill({ contentType: "application/json", body: await curl(url) });
      } catch (e) {
        return route.fulfill({ status: 502, body: String(e.message) });
      }
    });
    return page;
  };

  state.close = async () => { await browser.close(); state.server.close(); };
  return state;
}

/* Kleine Prüf-Sammlung mit lesbarer Ausgabe */
function suite(name) {
  const results = [];
  return {
    name, results,
    ok(label, cond, info = "") { results.push({ pass: !!cond, label, info }); },
    report() {
      for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}${r.info ? "  — " + r.info : ""}`);
      return results.filter(r => !r.pass).length;
    }
  };
}

module.exports = { launch, suite, LIVE };
