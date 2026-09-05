#!/usr/bin/env node
/**
 * Projectdoc-bridge — draait op de pc die altijd aanstaat.
 *
 * De telefoon-app praat hiermee; deze bridge leest en schrijft de
 * Project_[Naam].docx bestanden in de OneDrive-map en laat Claude Code
 * (op het abonnement waarmee op deze pc is ingelogd) het denkwerk doen.
 *
 * Rolverdeling, bewust zo:
 *   Claude  = taal — begrijpen, corrigeren, formuleren in Ivo's stijl.
 *   Bridge  = bestanden — inlezen, wegschrijven, back-uppen.
 * Claude komt dus nooit zelf aan een bestand, en de opmaak van het document
 * kan niet stukgaan door een model dat XML probeert te bewerken.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const docx = require("./lib/docx");
const { vraagClaude, vraagJson, zelftest } = require("./lib/claude");
const { vraagPrompt, voorstelPrompt, SCHEMA_VOORSTEL } = require("./lib/prompts");

const VERSIE = "1.0.0";
const MAX_BODY = 2 * 1024 * 1024;
const CONFIG_PAD = process.env.PROJECTDOC_CONFIG || path.join(__dirname, "config.json");

/* ---------------------------------------------------------------- config */

function laadConfig() {
  if (!fs.existsSync(CONFIG_PAD)) {
    console.error(`Geen config gevonden op ${CONFIG_PAD}.`);
    console.error("Kopieer config.example.json naar config.json en vul hem in.");
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PAD, "utf8"));
  if (!cfg.token || cfg.token.length < 16) {
    console.error("Zet in config.json een 'token' van minstens 16 tekens.");
    process.exit(1);
  }
  if (!cfg.projectenMap || !fs.existsSync(cfg.projectenMap)) {
    console.error(`De map bij 'projectenMap' bestaat niet: ${cfg.projectenMap}`);
    process.exit(1);
  }
  return {
    poort: 8787,
    model: "opus",
    claudeCommando: "claude",
    origins: ["https://imetech-engineering.github.io", "http://localhost:8080", "http://127.0.0.1:8080"],
    maxBackups: 40,
    ...cfg,
  };
}

const config = laadConfig();
const claudeOpties = { model: config.model, commando: config.claudeCommando };

/* -------------------------------------------------------------- projecten */

const OVERSLAAN = new Set(["_backups", "node_modules", ".git"]);
let projectCache = { tijd: 0, lijst: [] };

function zoekProjecten(map, diepte = 0) {
  const uit = [];
  let items;
  try {
    items = fs.readdirSync(map, { withFileTypes: true });
  } catch (_) {
    return uit;
  }
  for (const item of items) {
    if (item.name.startsWith(".") || item.name.startsWith("~$")) continue;
    const vol = path.join(map, item.name);
    if (item.isDirectory()) {
      if (diepte >= 4 || OVERSLAAN.has(item.name)) continue;
      uit.push(...zoekProjecten(vol, diepte + 1));
    } else if (/^Project_.+\.docx$/i.test(item.name)) {
      let stat;
      try {
        stat = fs.statSync(vol);
      } catch (_) {
        continue;
      }
      uit.push({
        naam: item.name.replace(/^Project_/i, "").replace(/\.docx$/i, "").replace(/_/g, " "),
        bestand: item.name,
        pad: vol,
        gewijzigd: stat.mtime.toISOString(),
      });
    }
  }
  return uit;
}

function projecten(ververs = false) {
  if (!ververs && Date.now() - projectCache.tijd < 15000) return projectCache.lijst;
  const lijst = zoekProjecten(config.projectenMap).sort(
    (a, b) => new Date(b.gewijzigd) - new Date(a.gewijzigd)
  );
  projectCache = { tijd: Date.now(), lijst };
  return lijst;
}

function zoekProject(naam) {
  const doel = String(naam || "").toLowerCase().trim();
  const lijst = projecten();
  return (
    lijst.find((p) => p.naam.toLowerCase() === doel) ||
    lijst.find((p) => p.bestand.toLowerCase() === doel) ||
    lijst.find((p) => p.naam.toLowerCase().replace(/\s+/g, "") === doel.replace(/\s+/g, "")) ||
    null
  );
}

/* ---------------------------------------------------------------- backups */

function maakBackup(bestandsPad) {
  const map = path.join(config.projectenMap, "_backups");
  fs.mkdirSync(map, { recursive: true });
  const stempel = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const doel = path.join(map, `${path.basename(bestandsPad, ".docx")}_${stempel}.docx`);
  fs.copyFileSync(bestandsPad, doel);

  // Oude back-ups opruimen, anders groeit dit ongemerkt in OneDrive.
  const oud = fs
    .readdirSync(map)
    .filter((n) => n.endsWith(".docx"))
    .map((n) => ({ n, t: fs.statSync(path.join(map, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(config.maxBackups);
  for (const { n } of oud) {
    try {
      fs.unlinkSync(path.join(map, n));
    } catch (_) {}
  }
  return path.basename(doel);
}

/* ------------------------------------------------------------------- http */

function stuur(res, status, data, origin) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...corsHeaders(origin),
  });
  res.end(body);
}

function corsHeaders(origin) {
  if (!origin || !config.origins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function tokenKlopt(req) {
  const kop = req.headers.authorization || "";
  const gegeven = kop.startsWith("Bearer ") ? kop.slice(7) : "";
  const a = Buffer.from(gegeven);
  const b = Buffer.from(config.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function leesBody(req) {
  return new Promise((resolve, reject) => {
    let lengte = 0;
    const delen = [];
    req.on("data", (d) => {
      lengte += d.length;
      if (lengte > MAX_BODY) {
        reject(new Error("Verzoek te groot"));
        req.destroy();
        return;
      }
      delen.push(d);
    });
    req.on("end", () => {
      if (!delen.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(delen).toString("utf8")));
      } catch (_) {
        reject(new Error("Onleesbare JSON in het verzoek"));
      }
    });
    req.on("error", reject);
  });
}

/* --------------------------------------------------------------- afhandeling */

async function afhandelen(req, res, url) {
  const pad = url.pathname;

  if (pad === "/api/status" && req.method === "GET") {
    return {
      ok: true,
      versie: VERSIE,
      model: config.model,
      projectenMap: config.projectenMap,
      aantalProjecten: projecten().length,
    };
  }

  if (pad === "/api/zelftest" && req.method === "GET") {
    const ok = await zelftest(claudeOpties);
    return { ok, melding: ok ? "Claude reageert" : "Claude gaf een onverwacht antwoord" };
  }

  if (pad === "/api/projecten" && req.method === "GET") {
    const ververs = url.searchParams.get("ververs") === "1";
    return {
      projecten: projecten(ververs).map(({ naam, bestand, gewijzigd }) => ({ naam, bestand, gewijzigd })),
    };
  }

  if (pad === "/api/project" && req.method === "GET") {
    const p = zoekProject(url.searchParams.get("naam"));
    if (!p) return { fout: "Project niet gevonden" };
    const { xml } = docx.open(p.pad);
    const tekst = docx.documentTekst(xml);
    return {
      naam: p.naam,
      bestand: p.bestand,
      gewijzigd: p.gewijzigd,
      header: docx.headerVelden(xml),
      laatsteEntries: laatsteEntries(tekst, 3),
    };
  }

  if (pad === "/api/vraag" && req.method === "POST") {
    const body = await leesBody(req);
    const p = zoekProject(body.project);
    if (!p) return { fout: "Project niet gevonden" };
    if (!String(body.vraag || "").trim()) return { fout: "Geen vraag meegegeven" };
    const { xml } = docx.open(p.pad);
    const antwoord = await vraagClaude(
      vraagPrompt({
        projectNaam: p.naam,
        documentTekst: docx.documentTekst(xml),
        vraag: body.vraag,
        historie: body.historie,
      }),
      claudeOpties
    );
    return { antwoord: antwoord.tekst, duurMs: antwoord.duurMs };
  }

  if (pad === "/api/voorstel" && req.method === "POST") {
    const body = await leesBody(req);
    const p = zoekProject(body.project);
    if (!p) return { fout: "Project niet gevonden" };
    if (!String(body.notities || "").trim()) return { fout: "Geen notities meegegeven" };
    const { xml } = docx.open(p.pad);
    const { data, duurMs } = await vraagJson(
      voorstelPrompt({
        projectNaam: p.naam,
        documentTekst: docx.documentTekst(xml),
        headerVelden: docx.headerVelden(xml),
        notities: body.notities,
        historie: body.historie,
      }),
      SCHEMA_VOORSTEL,
      claudeOpties
    );
    return { ...data, project: p.naam, bestand: p.bestand, duurMs };
  }

  if (pad === "/api/opslaan" && req.method === "POST") {
    const body = await leesBody(req);
    const p = zoekProject(body.project);
    if (!p) return { fout: "Project niet gevonden" };
    const entry = body.entry;
    if (!entry || !entry.kop) return { fout: "Geen entry meegegeven" };

    const { onderdelen, xml } = docx.open(p.pad);
    let nieuw = xml;
    const toegepast = [];
    const overgeslagen = [];
    for (const w of body.headerWijzigingen || []) {
      const uit = docx.zetHeaderWaarde(nieuw, w.label, w.nieuweWaarde);
      if (uit) {
        nieuw = uit;
        toegepast.push(w.label);
      } else {
        overgeslagen.push(w.label);
      }
    }
    nieuw = docx.voegEntryToe(nieuw, entry);

    const backup = maakBackup(p.pad);
    docx.bewaar(p.pad, onderdelen, nieuw);
    projectCache.tijd = 0;
    return { ok: true, bestand: p.bestand, backup, headerToegepast: toegepast, headerOvergeslagen: overgeslagen };
  }

  if (pad === "/api/nieuwproject" && req.method === "POST") {
    const body = await leesBody(req);
    const naam = String(body.naam || "").trim();
    if (!/^[\w \-&.()]{2,60}$/.test(naam)) return { fout: "Ongeldige projectnaam" };
    const sjabloon = zoekProject(body.sjabloon) || projecten()[0];
    if (!sjabloon) return { fout: "Geen bestaand project om de opmaak van over te nemen" };

    const bestandsnaam = `Project_${naam.replace(/\s+/g, "_")}.docx`;
    const doel = path.join(config.projectenMap, bestandsnaam);
    if (fs.existsSync(doel)) return { fout: `${bestandsnaam} bestaat al` };

    const { onderdelen, xml } = docx.open(sjabloon.pad);
    let nieuw = docx.leegLogboek(xml);
    nieuw = docx.zetTitel(nieuw, body.titel || naam);
    for (const [label, waarde] of Object.entries(body.header || {})) {
      const uit = docx.zetHeaderWaarde(nieuw, label, waarde);
      if (uit) nieuw = uit;
    }
    docx.bewaar(doel, onderdelen, nieuw);
    projectCache.tijd = 0;
    return { ok: true, bestand: bestandsnaam, naam };
  }

  return { fout: "Onbekend verzoek", status: 404 };
}

/** Kop + eerste zin van de laatste paar entries, voor de projectkaart in de app. */
function laatsteEntries(tekst, aantal) {
  const regels = tekst.split("\n");
  const uit = [];
  for (let i = 0; i < regels.length && uit.length < aantal; i++) {
    const m = /^(\d{6})\s+(.+)$/.exec(regels[i].trim());
    if (!m) continue;
    const vervolg = (regels[i + 1] || "").trim();
    uit.push({ datum: m[1], kop: m[2], eersteRegel: /^\d{6}\s/.test(vervolg) ? "" : vervolg });
  }
  return uit;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    stuur(res, 404, { fout: "Niet gevonden" }, origin);
    return;
  }
  if (!tokenKlopt(req)) {
    stuur(res, 401, { fout: "Ongeldig token" }, origin);
    return;
  }

  try {
    const uit = await afhandelen(req, res, url);
    if (res.writableEnded) return;
    const status = uit.status || (uit.fout ? 400 : 200);
    delete uit.status;
    stuur(res, status, uit, origin);
  } catch (e) {
    console.error(`[fout] ${url.pathname}:`, e.message);
    stuur(res, 500, { fout: e.message }, origin);
  }
});

server.listen(config.poort, config.host || "127.0.0.1", () => {
  console.log(`Projectdoc-bridge ${VERSIE} luistert op poort ${config.poort}`);
  console.log(`Projectenmap: ${config.projectenMap}`);
  console.log(`Gevonden projecten: ${projecten().length}`);
  console.log(`Model: ${config.model}`);
});
