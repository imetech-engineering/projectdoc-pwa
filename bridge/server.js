#!/usr/bin/env node
/**
 * Projectdoc-bridge — draait op de pc die altijd aanstaat.
 *
 * De telefoon-app praat hiermee; deze bridge leest en schrijft de
 * Project_[Naam].docx bestanden in de OneDrive-map en laat Claude Code
 * (op het abonnement waarmee op deze pc is ingelogd) het denkwerk doen.
 *
 * Rolverdeling, bewust zo:
 *   Claude  = taal — begrijpen, corrigeren, formuleren in jouw stijl.
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
const { vraagClaude, vraagJson, zelftest, startwijze } = require("./lib/claude");
const mailZoeker = require("./lib/mail");
const { gekoppeld: mailGekoppeld } = require("./lib/graph");
const { vraagPrompt, voorstelPrompt, SCHEMA_VOORSTEL } = require("./lib/prompts");

const VERSIE = "1.5.0";
const MAX_BODY = 2 * 1024 * 1024;
const CONFIG_PAD = process.env.PROJECTDOC_CONFIG || path.join(__dirname, "config.json");

/* ---------------------------------------------------------------- config */

function laadConfig() {
  if (!fs.existsSync(CONFIG_PAD)) {
    console.error(`Geen config gevonden op ${CONFIG_PAD}.`);
    console.error("Kopieer config.example.json naar config.json en vul hem in.");
    process.exit(1);
  }
  // PowerShell schrijft met Set-Content -Encoding UTF8 een BOM aan het begin,
  // en daar struikelt JSON.parse over. Gewoon weghalen.
  const ruw = fs.readFileSync(CONFIG_PAD, "utf8").replace(/^\uFEFF/, "");
  let cfg;
  try {
    cfg = JSON.parse(ruw);
  } catch (e) {
    console.error(`config.json is geen geldige JSON: ${e.message}`);
    process.exit(1);
  }
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
    schrijver: "de schrijver van dit logboek",
    initialen: "IM",
    origins: ["https://imetech-engineering.github.io", "http://localhost:8080", "http://127.0.0.1:8080"],
    maxBackups: 40,
    ...cfg,
    mail: { aan: false, dagen: 60, maxBerichten: 15, ...(cfg.mail || {}) },
  };
}

const config = laadConfig();
const claudeOpties = { model: config.model, commando: config.claudeCommando };

/* -------------------------------------------------------------- projecten */

// Archiefmappen bevatten oudere kopieën van dezelfde projecten; die horen niet
// in de keuzelijst thuis, anders kies je er zo eentje per ongeluk.
const OVERSLAAN = [/^_backups$/i, /^node_modules$/i, /^\.git$/i, /^archief$/i, /^archive$/i, /^oud$/i];
const PROJECTBESTAND = /^Project[ _].+\.docx$/i;
// Een kopie herken je aan een markering áán het eind van de naam, eventueel
// gevolgd door een datum: "..._backup_260831b.docx", "... - kopie.docx". Een
// project dat toevallig over back-ups gáát blijft gewoon staan.
const KOPIE = /[ _-](backup|bak|kopie|copy|old|oud)([ _-]?\d{0,8}[a-z]?)?\.docx$|\(\d+\)\.docx$/i;
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
      if (diepte >= 5 || OVERSLAAN.some((r) => r.test(item.name))) continue;
      uit.push(...zoekProjecten(vol, diepte + 1));
    } else if (PROJECTBESTAND.test(item.name) && !KOPIE.test(item.name)) {
      let stat;
      try {
        stat = fs.statSync(vol);
      } catch (_) {
        continue;
      }
      uit.push({
        naam: item.name
          .replace(/^Project[ _]/i, "")
          .replace(/\.docx$/i, "")
          .replace(/_/g, " ")
          .trim(),
        bestand: item.name,
        map: path.basename(path.dirname(vol)),
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
  const plat = (t) => t.toLowerCase().replace(/[\s_]+/g, "");
  return (
    lijst.find((p) => p.naam.toLowerCase() === doel) ||
    lijst.find((p) => p.bestand.toLowerCase() === doel) ||
    lijst.find((p) => plat(p.naam) === plat(doel)) ||
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
      mail: { aan: !!config.mail.aan, gekoppeld: mailGekoppeld() },
      claude: claudeInfo(),
    };
  }

  if (pad === "/api/zelftest" && req.method === "GET") {
    const ok = await zelftest(claudeOpties);
    return { ok, melding: ok ? "Claude reageert" : "Claude gaf een onverwacht antwoord" };
  }

  if (pad === "/api/projecten" && req.method === "GET") {
    const ververs = url.searchParams.get("ververs") === "1";
    return {
      projecten: projecten(ververs).map(({ naam, bestand, map, gewijzigd }) => ({ naam, bestand, map, gewijzigd })),
    };
  }

  if (pad === "/api/project" && req.method === "GET") {
    const p = zoekProject(url.searchParams.get("naam"));
    if (!p) return { fout: "Project niet gevonden" };
    const { xml } = docx.open(p.pad);
    return {
      naam: p.naam,
      bestand: p.bestand,
      map: p.map,
      gewijzigd: p.gewijzigd,
      header: docx.headerVelden(xml),
      entries: docx.logboekEntries(xml),
    };
  }

  /**
   * Mail is aanvulling, geen voorwaarde: gaat het ophalen mis, dan gaat de
   * vraag of het voorstel gewoon door zonder. Wat er misging komt terug naar
   * de app, zodat je het wel ziet.
   */
  async function mailVoor(project, header) {
    if (!config.mail.aan) return { berichten: [], melding: null };
    try {
      const berichten = await mailZoeker.zoekVoorProject({
        projectNaam: project.naam,
        headerVelden: header,
        config: config.mail,
      });
      return { berichten, melding: null };
    } catch (e) {
      console.error(`[mail] ${e.message}`);
      return { berichten: [], melding: `Mail overslaan: ${e.message}` };
    }
  }

  if (pad === "/api/vraag" && req.method === "POST") {
    const body = await leesBody(req);
    const p = zoekProject(body.project);
    if (!p) return { fout: "Project niet gevonden" };
    if (!String(body.vraag || "").trim()) return { fout: "Geen vraag meegegeven" };
    const { xml } = docx.open(p.pad);
    const mail = await mailVoor(p, docx.headerVelden(xml));
    const antwoord = await vraagClaude(
      vraagPrompt({
        projectNaam: p.naam,
        documentTekst: docx.documentTekst(xml),
        vraag: body.vraag,
        historie: body.historie,
        mail: mail.berichten,
      }),
      claudeOpties
    );
    return {
      antwoord: antwoord.tekst,
      duurMs: antwoord.duurMs,
      mailGebruikt: mail.berichten.map(kortMail),
      mailMelding: mail.melding,
    };
  }

  if (pad === "/api/voorstel" && req.method === "POST") {
    const body = await leesBody(req);
    const p = zoekProject(body.project);
    if (!p) return { fout: "Project niet gevonden" };
    if (!String(body.notities || "").trim()) return { fout: "Geen notities meegegeven" };
    const { xml } = docx.open(p.pad);
    const header = docx.headerVelden(xml);
    const mail = await mailVoor(p, header);
    const { data, duurMs } = await vraagJson(
      voorstelPrompt({
        projectNaam: p.naam,
        documentTekst: docx.documentTekst(xml),
        headerVelden: header,
        notities: body.notities,
        historie: body.historie,
        schrijver: config.schrijver,
        initialen: config.initialen,
        mail: mail.berichten,
      }),
      SCHEMA_VOORSTEL,
      claudeOpties
    );
    return {
      ...data,
      project: p.naam,
      bestand: p.bestand,
      duurMs,
      mailGebruikt: mail.berichten.map(kortMail),
      mailMelding: mail.melding,
    };
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

    // Neem de naamgeving over van het sjabloon: sommige mappen gebruiken een
    // spatie na "Project", andere een underscore.
    const scheiding = /^Project_/i.test(sjabloon.bestand) ? "_" : " ";
    const bestandsnaam = `Project${scheiding}${naam}.docx`;
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

/** Waar Claude Code staat en hoe hij gestart wordt. */
function claudeInfo() {
  const wijze = startwijze(config.claudeCommando);
  if (!wijze) return { gevonden: false, route: null, pad: null };
  return { gevonden: true, route: wijze.route, pad: wijze.pad };
}

/** Wat de app van een meegelezen bericht te zien krijgt. */
function kortMail(b) {
  return { van: b.van, datum: b.datum, onderwerp: b.onderwerp, gevondenOp: b.gevondenOp };
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

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Poort ${config.poort} is al bezet — er draait nog een bridge.`);
    console.error("Sluit die eerst af; opnieuw starten heeft tot die tijd geen zin.");
    process.exit(3);
  }
  throw e;
});

server.listen(config.poort, config.host || "127.0.0.1", () => {
  console.log(`Projectdoc-bridge ${VERSIE} luistert op poort ${config.poort}`);
  console.log(`Projectenmap: ${config.projectenMap}`);
  console.log(`Gevonden projecten: ${projecten().length}`);
  console.log(`Model: ${config.model}`);
  console.log(
    config.mail.aan
      ? mailGekoppeld()
        ? `Mail: aan, laatste ${config.mail.dagen} dagen, max ${config.mail.maxBerichten} berichten`
        : "Mail: aangezet maar nog niet gekoppeld — draai: node koppel-mail.js"
      : "Mail: uit"
  );

  // Meteen bij het starten melden of Claude Code te vinden is. Anders merk je
  // het pas als je de eerste vraag stelt, en dat is een vervelend moment.
  const wijze = startwijze(config.claudeCommando);
  if (wijze) {
    const uitleg = { node: "rechtstreeks met node", cmd: "via de opdrachtprompt", direct: "rechtstreeks" };
    console.log(`Claude Code: ${wijze.pad} (${uitleg[wijze.route] || wijze.route})`);
  } else {
    console.log("");
    console.log("LET OP: Claude Code is niet gevonden. Vragen en voorstellen gaan mislukken.");
    console.log("Zoek het pad op met:  Get-Command claude | Select-Object -ExpandProperty Source");
    console.log("en zet dat in config.json bij 'claudeCommando'.");
  }
});
