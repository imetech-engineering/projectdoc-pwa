/**
 * Offertes en facturen per project, voor de tijdlijn in de app.
 *
 * Bronnen (alleen lezen, nooit schrijven):
 *   - offertes:  "03 Offertes" (OFjjmmnn_Klant.docx/.pdf, ook in submappen)
 *   - facturen:  het Verkoopboek in Boekhouding_IMeTech.xlsx, betaald = factuurnummer
 *                staat bij een bijschrijving in het Bankboek
 *   - pdf's:     "02 Boekhouding/01 Verkoop facturen"
 * Wat je in de app zelf kiest (afronden, heropenen, ander project) komt in
 * data/geld_keuzes.json naast de bridge; de boekhouding blijft onaangeroerd.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { leesZip, pakUit } = require("./zip");
const docx = require("./docx");

const NR_OFFERTE = /\b((?:OF|PR)\d{6})\b/gi;
const NR_FACTUUR = /\b((?:FA|CN)\d{6})\b/gi;
const EIND = /\b(eind|rest|slot|laatste termijn|oplevering)/i;
const STOP = new Set([
  "engineering", "imetech", "solutions", "business", "holding", "group", "groep", "project", "projecten",
  "klanten", "the", "and", "van", "voor", "met", "het", "een", "der", "den", "bij", "nl", "bv", "b", "v",
  "incl", "excl", "btw", "aanbetaling", "factuur", "offerte", "inkoop", "werkzaamheden", "fase", "serie",
  "stuks", "custom", "pcb", "aanvragen", "archief", "juni", "juli", "augustus", "september", "oktober",
]);

/* ---------------------------------------------------------------- hulpjes */

const plat = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (s) => plat(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

function bedrag(s) {
  if (typeof s === "number") return s;
  const t = String(s || "").replace(/[€\s ]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const ontEsc = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&");

function serieelNaarIso(v) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v) * 86400000));
  return d.toISOString().slice(0, 10);
}

/** "16-09-2026" → "2026-09-16"; anders null. */
function nlDatum(s) {
  const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(String(s || ""));
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** OF260904 → 2026-09-01 (de maand staat in het nummer). */
const datumUitNummer = (nr) => `20${nr.slice(2, 4)}-${nr.slice(4, 6)}-01`;

function alleNummers(tekst, re) {
  const uit = new Set();
  for (const m of String(tekst || "").matchAll(re)) uit.add(m[1].toUpperCase());
  return uit;
}

/* ------------------------------------------------------------------- xlsx */

/** Leest de gevraagde bladen als rijen met cellen (kolom A = index 0). */
function leesXlsx(pad, bladen) {
  const delen = leesZip(fs.readFileSync(pad));
  const lees = (naam) => {
    const d = delen.find((o) => o.naam === naam);
    return d ? pakUit(d).toString("utf8") : "";
  };
  const gedeeld = [];
  for (const si of lees("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) || []) {
    let t = "";
    for (const m of si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += m[1];
    gedeeld.push(ontEsc(t));
  }
  const rels = {};
  for (const m of lees("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]);
    const doel = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && doel) rels[id[1]] = doel[1].replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const uit = {};
  for (const m of lees("xl/workbook.xml").matchAll(/<sheet\s[^>]*>/g)) {
    const naam = /\bname="([^"]+)"/.exec(m[0]);
    const rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (!naam || !rid || !bladen.includes(ontEsc(naam[1]))) continue;
    const xml = lees("xl/" + rels[rid[1]]);
    const rijen = [];
    for (const c of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(c[1]);
      if (!ref) continue;
      const kol = [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const rij = +ref[2] - 1;
      const type = (/\bt="([^"]+)"/.exec(c[1]) || [])[1];
      const binnen = c[2] || "";
      const v = (/<v>([\s\S]*?)<\/v>/.exec(binnen) || [])[1];
      let w = null;
      if (type === "s") w = v != null ? gedeeld[+v] : null;
      else if (type === "inlineStr") w = ontEsc(((/<t[^>]*>([\s\S]*?)<\/t>/.exec(binnen) || [])[1]) || "");
      else if (type === "str" || type === "e") w = v != null ? ontEsc(v) : null;
      else if (type === "b") w = v === "1";
      else if (v != null && v !== "") w = Number(v);
      (rijen[rij] = rijen[rij] || [])[kol] = w;
    }
    uit[ontEsc(naam[1])] = rijen;
  }
  return uit;
}

/** Zoekt de kopregel en geeft per gezochte kop de kolomindex. */
function kolommen(rijen, verplicht, wensen) {
  for (let i = 0; i < Math.min(rijen.length, 30); i++) {
    const r = Array.from(rijen[i] || [], (c) => (typeof c === "string" ? c.replace(/\s+/g, " ").trim().toLowerCase() : ""));
    if (!r.some((c) => c.startsWith(verplicht))) continue;
    const idx = {};
    for (const [sleutel, begin] of Object.entries(wensen)) idx[sleutel] = r.findIndex((c) => c.startsWith(begin));
    return { kop: i, idx };
  }
  return null;
}

function leesBoekhouding(pad) {
  const bladen = leesXlsx(pad, ["Verkoopboek totaal", "Bankboek"]);
  const facturen = [];
  const vk = bladen["Verkoopboek totaal"] || [];
  const k = kolommen(vk, "factuurnr", {
    datum: "factuurdatum", klant: "klant", oms: "omschrijving", nr: "factuurnr", incl: "bedrag incl", netto: "netto",
  });
  if (k) {
    for (const r of vk.slice(k.kop + 1)) {
      if (!r) continue;
      const nr = String(r[k.idx.nr] || "").trim().toUpperCase();
      if (!/^(FA|CN)\d{6}$/.test(nr)) continue;
      const d = r[k.idx.datum];
      let oms = r[k.idx.oms];
      if (typeof oms === "number") oms = oms > 30000 && oms < 80000 ? serieelNaarIso(oms).slice(0, 7) : String(oms);
      facturen.push({
        nummer: nr,
        datum: typeof d === "number" ? serieelNaarIso(d) : nlDatum(d) || datumUitNummer(nr),
        klant: String(r[k.idx.klant] || "").trim(),
        omschrijving: String(oms || "").trim(),
        incl: bedrag(r[k.idx.incl]),
        netto: bedrag(r[k.idx.netto]),
      });
    }
  }
  const betaald = {};
  const bb = bladen["Bankboek"] || [];
  const b = kolommen(bb, "datum", { datum: "datum", oms: "omschrijving", in: "in", factuur: "factuur" });
  if (b) {
    for (const r of bb.slice(b.kop + 1)) {
      if (!r || !(bedrag(r[b.idx.in]) > 0)) continue;
      const d = r[b.idx.datum];
      const tekst = `${r[b.idx.factuur] || ""} ${r[b.idx.oms] || ""}`;
      for (const nr of alleNummers(tekst, NR_FACTUUR)) {
        betaald[nr] = typeof d === "number" ? serieelNaarIso(d) : nlDatum(d) || true;
      }
    }
  }
  return { facturen, betaald };
}

/* --------------------------------------------------------------- offertes */

function lijstBestanden(map, re, diepte = 0) {
  const uit = [];
  let items;
  try {
    items = fs.readdirSync(map, { withFileTypes: true });
  } catch (_) {
    return uit;
  }
  for (const it of items) {
    if (it.name.startsWith(".") || it.name.startsWith("~$") || it.name.startsWith("_")) continue;
    const vol = path.join(map, it.name);
    if (it.isDirectory()) {
      if (diepte < 3) uit.push(...lijstBestanden(vol, re, diepte + 1));
    } else if (re.test(it.name) && !/backup|kopie|copy/i.test(it.name) && /\.(pdf|docx)$/i.test(it.name)) {
      uit.push(vol);
    }
  }
  return uit;
}

/** Leest de offerte-docx: klant, onderwerp, meta-tabel en regels. */
function leesOfferteDocx(pad) {
  const { xml } = docx.open(pad);
  const { kinderen } = docx.bodyKinderen(xml);
  const uit = { klant: "", onderwerp: "", referentie: "", datum: null, geldigheid: "", regels: [], totaalExcl: null, totaalIncl: null };
  for (const kind of kinderen) {
    if (kind.naam === "w:p") {
      const t = docx.alineaTekst(kind.xml).trim();
      const aan = /^Aan:\s*(.+)$/i.exec(t);
      if (aan && !uit.klant) uit.klant = aan[1].trim();
      const ow = /offerte aan voor (?:het project |de |het )?(.+?)(?:[,.]|$)/i.exec(t);
      if (ow && !uit.onderwerp) uit.onderwerp = ow[1].trim();
      continue;
    }
    if (kind.naam !== "w:tbl") continue;
    const rijen = docx.pakAlle(kind.xml, "w:tr").map((r) =>
      docx.pakAlle(r, "w:tc").map((c) => docx.pakAlle(c, "w:p").map(docx.alineaTekst).join(" ").trim())
    );
    for (let i = 0; i < rijen.length; i++) {
      const c = rijen[i];
      if (/^offertenummer$/i.test(c[0] || "") && rijen[i + 1]) {
        const v = rijen[i + 1];
        const kol = (naam) => c.findIndex((x) => x.toLowerCase().startsWith(naam));
        uit.datum = nlDatum(v[kol("offertedatum")]) || uit.datum;
        uit.geldigheid = v[kol("geldigheid")] || "";
        uit.referentie = v[kol("uw referentie")] || "";
      }
    }
    const kopRij = rijen.findIndex((c) => /^omschrijving$/i.test(c[0] || "") && c.some((x) => /subtotaal/i.test(x)));
    if (kopRij < 0) continue;
    for (const c of rijen.slice(kopRij + 1)) {
      const laatste = c[c.length - 1];
      if (/^totaal excl/i.test(c[0] || "")) uit.totaalExcl = bedrag(laatste);
      else if (/^totaal$/i.test(c[0] || "")) uit.totaalIncl = bedrag(laatste);
      else if (/btw/i.test(c[0] || "")) continue;
      else if ((c[0] || "").trim() && bedrag(laatste) != null) uit.regels.push({ omschrijving: c[0].trim(), bedrag: bedrag(laatste) });
    }
  }
  return uit;
}

/* ------------------------------------------------------------ de koppeling */

function klantPast(klant, projTekst) {
  const k = plat(klant);
  if (!k) return false;
  const compact = projTekst.replace(/ /g, "");
  if (k.replace(/ /g, "").length >= 5 && compact.includes(k.replace(/ /g, ""))) return true;
  const woorden = ` ${projTekst} `;
  return tokens(klant).some((t) => t.length >= 4 && woorden.includes(` ${t} `));
}

function overlap(a, b, zonder = new Set()) {
  const set = new Set(tokens(b));
  return new Set(tokens(a).filter((t) => set.has(t) && !zonder.has(t))).size;
}

/** Kiest het project met de hoogste score; bij gelijkspel geen keuze. */
function beste(scores) {
  const lijst = [...scores].filter((s) => s.score >= 10).sort((a, b) => b.score - a.score);
  if (!lijst.length) return null;
  if (lijst[1] && lijst[1].score === lijst[0].score && lijst[0].score < 100) return null;
  return lijst[0];
}

function maakGeld({ projectenMap, offertesMap, facturenMap, boekhoudingPad, keuzesPad }) {
  const basis = path.dirname(projectenMap);
  offertesMap = offertesMap || path.join(basis, "03 Offertes");
  facturenMap = facturenMap || path.join(basis, "02 Boekhouding", "01 Verkoop facturen");
  boekhoudingPad = boekhoudingPad || path.join(basis, "02 Boekhouding", "Boekhouding_IMeTech.xlsx");

  const cache = new Map(); // pad → {mtime, data}
  function gecached(pad, maak) {
    let mtime = 0;
    try {
      mtime = fs.statSync(pad).mtimeMs;
    } catch (_) {
      return null;
    }
    const c = cache.get(pad);
    if (c && c.mtime === mtime) return c.data;
    let data = null;
    try {
      data = maak(pad);
    } catch (e) {
      console.error(`[geld] ${path.basename(pad)}: ${e.message}`);
    }
    cache.set(pad, { mtime, data });
    return data;
  }

  /* keuzes */
  function keuzes() {
    try {
      return { offertes: {}, facturen: {}, ...JSON.parse(fs.readFileSync(keuzesPad, "utf8")) };
    } catch (_) {
      return { offertes: {}, facturen: {} };
    }
  }
  function bewaarKeuzes(k) {
    fs.mkdirSync(path.dirname(keuzesPad), { recursive: true });
    const tmp = keuzesPad + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(k, null, 1));
    fs.renameSync(tmp, keuzesPad);
    resultaat = null;
  }

  /* offertes-index */
  function offertes() {
    const perNr = new Map();
    for (const pad of lijstBestanden(offertesMap, /^(OF|PR)\d{6}/i)) {
      const nr = /^((?:OF|PR)\d{6})/i.exec(path.basename(pad))[1].toUpperCase();
      const o = perNr.get(nr) || { nummer: nr, pdf: null, docx: null, map: "" };
      const ext = path.extname(pad).toLowerCase();
      const stat = fs.statSync(pad);
      const huidig = o[ext.slice(1)];
      // Liever het bestand buiten "Archief", en anders het nieuwste.
      const inArchief = /[\\/]archief[\\/]/i.test(pad);
      if (!huidig || (huidig.archief && !inArchief) || (huidig.archief === inArchief && stat.mtimeMs > huidig.mtime)) {
        o[ext.slice(1)] = { pad, mtime: stat.mtimeMs, archief: inArchief };
      }
      if (!o.map || !inArchief) o.map = path.basename(path.dirname(pad));
      perNr.set(nr, o);
    }
    return [...perNr.values()].map((o) => {
      const inhoud = (o.docx && gecached(o.docx.pad, leesOfferteDocx)) || {};
      const naamDeel = path.basename((o.docx || o.pdf).pad).replace(/\.(pdf|docx)$/i, "").split("_").slice(1);
      const klantUitNaam = /^estede$/i.test(o.map) ? "ESTEDE" : (naamDeel[naamDeel.length - 1] === "ESTEDE" ? "ESTEDE" : naamDeel[0] || "");
      return {
        nummer: o.nummer,
        datum: inhoud.datum || datumUitNummer(o.nummer),
        klant: inhoud.klant || klantUitNaam,
        onderwerp: inhoud.onderwerp || naamDeel.slice(0, -1).join(" ") || "",
        referentie: inhoud.referentie || "",
        geldigheid: inhoud.geldigheid || "",
        regels: inhoud.regels || [],
        totaalExcl: inhoud.totaalExcl ?? null,
        totaalIncl: inhoud.totaalIncl ?? null,
        heeftPdf: !!o.pdf,
        heeftDocx: !!o.docx,
        _pad: (o.pdf || o.docx).pad,
      };
    });
  }

  function factuurBestand(nr) {
    const kandidaten = lijstBestanden(facturenMap, new RegExp(`^${nr}`, "i")).filter((p) => !/_test/i.test(p));
    return kandidaten.find((p) => /\.pdf$/i.test(p)) || kandidaten[0] || null;
  }

  /* projectinfo voor het koppelen */
  function projectInfo(p) {
    return gecached(p.pad, () => {
      const { xml } = docx.open(p.pad);
      const tekst = docx.documentTekst(xml);
      const header = docx.headerVelden(xml);
      const rel = path.relative(projectenMap, path.dirname(p.pad));
      const velden = header
        .filter((h) => /projectnummer|contact|bedrijf|eindklant|opdrachtgever|klant/i.test(h.label))
        .map((h) => h.waarde)
        .join(" ");
      return {
        naam: p.naam,
        nummer: (/^(\d{4})\b/.exec(p.map) || [])[1] || null,
        klantTekst: plat(`${rel} ${velden}`),
        naamTekst: `${p.naam} ${p.map}`,
        offertesInDoc: alleNummers(tekst, NR_OFFERTE),
        facturenInDoc: alleNummers(tekst, NR_FACTUUR),
      };
    });
  }

  let resultaat = null; // { tijd, data }

  function bereken(alleProjecten) {
    if (resultaat && Date.now() - resultaat.tijd < 20000) return resultaat.data;
    const k = keuzes();
    const infos = alleProjecten.map(projectInfo).filter(Boolean);
    const ofs = offertes();
    const boek = gecached(boekhoudingPad, leesBoekhouding) || { facturen: [], betaald: {} };

    // offerte → project
    for (const o of ofs) {
      const keuze = k.offertes[o.nummer] || {};
      if (keuze.project !== undefined) {
        o.project = keuze.project === "-" ? null : keuze.project;
        o.koppeling = "handmatig";
        continue;
      }
      const scores = infos.map((p) => {
        let s = 0;
        if (p.offertesInDoc.has(o.nummer)) s += 100;
        if (klantPast(o.klant, p.klantTekst)) s += 10;
        s += 5 * Math.min(3, overlap(`${o.onderwerp} ${o.referentie}`, p.naamTekst, new Set(tokens(o.klant))));
        return { p, score: s };
      });
      const b = beste(scores);
      o.project = b ? b.p.naam : null;
      o.koppeling = b ? (b.score >= 100 ? "document" : "auto") : null;
    }

    // factuur → project
    const facturen = boek.facturen.map((f) => ({ ...f, betaald: !!boek.betaald[f.nummer], betaaldOp: typeof boek.betaald[f.nummer] === "string" ? boek.betaald[f.nummer] : null }));
    for (const f of facturen) {
      const keuze = k.facturen[f.nummer] || {};
      if (keuze.project !== undefined) {
        f.project = keuze.project === "-" ? null : keuze.project;
        f.koppeling = "handmatig";
        continue;
      }
      const genoemd = alleNummers(f.omschrijving, NR_OFFERTE);
      const scores = infos.map((p) => {
        let s = 0;
        if (p.facturenInDoc.has(f.nummer)) s += 100;
        if (p.nummer && new RegExp(`(^|\\D)${p.nummer}(\\D|$)`).test(f.omschrijving)) s += 50;
        if (ofs.some((o) => o.project === p.naam && genoemd.has(o.nummer))) s += 50;
        if (klantPast(f.klant, p.klantTekst)) s += 10;
        s += 5 * Math.min(3, overlap(f.omschrijving, p.naamTekst, new Set(tokens(f.klant))));
        return { p, score: s };
      });
      const b = beste(scores);
      f.project = b ? b.p.naam : null;
      f.koppeling = b ? (b.score >= 100 ? "document" : "auto") : null;
    }

    // factuur → offerte binnen een project, en de status van elke offerte
    const perProject = new Map();
    for (const o of ofs) {
      o.gefactureerd = 0;
      o.facturen = [];
      if (o.project) (perProject.get(o.project) || perProject.set(o.project, []).get(o.project)).push(o);
    }
    const dag = (d) => new Date(d + "T00:00:00Z").getTime();
    for (const f of [...facturen].sort((a, b) => a.datum.localeCompare(b.datum))) {
      f.offerte = null;
      const kand = (perProject.get(f.project) || [])
        .filter((o) => dag(o.datum) <= dag(f.datum) + 7 * 86400000)
        .sort((a, b) => a.datum.localeCompare(b.datum));
      if (!kand.length) continue;
      const genoemd = alleNummers(f.omschrijving, NR_OFFERTE);
      let keuze = kand.find((o) => genoemd.has(o.nummer));
      if (!keuze) {
        const netto = Math.abs(f.netto || 0);
        const gescoord = kand.map((o, i) => {
          let s = -i * 0.1;
          const tot = o.totaalExcl;
          if (!tot || o.gefactureerd < tot * 0.98) s += 10;
          if (tot && netto) {
            const rest = tot - o.gefactureerd;
            if ([0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 1].some((pct) => Math.abs(netto - tot * pct) <= tot * 0.015) || Math.abs(netto - rest) <= tot * 0.015) s += 20;
          }
          s += 3 * Math.min(3, overlap(f.omschrijving, `${o.onderwerp} ${o.referentie} ${o.regels.map((r) => r.omschrijving).join(" ")}`, new Set(tokens(f.project))));
          return { o, s };
        });
        keuze = gescoord.sort((a, b) => b.s - a.s)[0].o;
      }
      f.offerte = keuze.nummer;
      keuze.gefactureerd += f.netto || 0;
      keuze.facturen.push(f.nummer);
      if (EIND.test(f.omschrijving)) keuze.eindfactuur = f.nummer;
    }
    for (const o of ofs) {
      const keuze = k.offertes[o.nummer] || {};
      o.gefactureerd = Math.round(o.gefactureerd * 100) / 100;
      if (keuze.afgerond === true) Object.assign(o, { status: "afgerond", reden: "Door jou afgerond", handmatig: true });
      else if (keuze.afgerond === false) Object.assign(o, { status: o.gefactureerd > 0 ? "loopt" : "open", reden: "Door jou heropend", handmatig: true });
      else if (o.eindfactuur) Object.assign(o, { status: "afgerond", reden: `Eindfactuur ${o.eindfactuur}` });
      else if (o.totaalExcl && o.gefactureerd >= o.totaalExcl * 0.98) Object.assign(o, { status: "afgerond", reden: "Volledig gefactureerd" });
      else Object.assign(o, { status: o.gefactureerd > 0 ? "loopt" : "open", reden: o.gefactureerd > 0 ? "Deels gefactureerd" : "Nog niets gefactureerd" });
      delete o.eindfactuur;
    }
    const data = { ofs, facturen };
    resultaat = { tijd: Date.now(), data };
    return data;
  }

  const zonderPad = ({ _pad, ...rest }) => rest;
  const jaarGeleden = () => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  function voorProject(naam, alleProjecten) {
    const { ofs, facturen } = bereken(alleProjecten);
    const offertesHier = ofs.filter((o) => o.project === naam).sort((a, b) => b.datum.localeCompare(a.datum));
    const facturenHier = facturen
      .filter((f) => f.project === naam)
      .sort((a, b) => b.datum.localeCompare(a.datum))
      .map((f) => ({ ...f, heeftBestand: !!factuurBestand(f.nummer) }));
    const grens = jaarGeleden();
    return {
      offertes: offertesHier.map(zonderPad),
      facturen: facturenHier,
      losseOffertes: ofs
        .filter((o) => !o.project && o.datum >= grens)
        .sort((a, b) => b.datum.localeCompare(a.datum))
        .slice(0, 20)
        .map(({ nummer, datum, klant, onderwerp, totaalExcl }) => ({ nummer, datum, klant, onderwerp, totaalExcl })),
      losseFacturen: facturen
        .filter((f) => !f.project && f.datum >= grens)
        .sort((a, b) => b.datum.localeCompare(a.datum))
        .slice(0, 20)
        .map(({ nummer, datum, klant, omschrijving, netto }) => ({ nummer, datum, klant, omschrijving, netto })),
    };
  }

  /** afgerond: true/false/null (null = weer automatisch); project: naam, "-" (geen) of null (weer automatisch). */
  function zet(soort, nummer, wijziging) {
    const nr = String(nummer || "").toUpperCase();
    const re = soort === "offerte" ? /^(OF|PR)\d{6}$/ : /^(FA|CN)\d{6}$/;
    if (!re.test(nr)) throw new Error("Ongeldig nummer");
    const k = keuzes();
    const bak = soort === "offerte" ? k.offertes : k.facturen;
    const huidig = { ...(bak[nr] || {}) };
    for (const veld of ["afgerond", "project"]) {
      if (!(veld in wijziging)) continue;
      if (wijziging[veld] === null) delete huidig[veld];
      else huidig[veld] = wijziging[veld];
    }
    if (Object.keys(huidig).length) bak[nr] = huidig;
    else delete bak[nr];
    bewaarKeuzes(k);
    return true;
  }

  function bestand(soort, nummer) {
    const nr = String(nummer || "").toUpperCase();
    if (soort === "offerte") {
      if (!/^(OF|PR)\d{6}$/.test(nr)) return null;
      const o = offertes().find((x) => x.nummer === nr);
      return o ? o._pad : null;
    }
    if (!/^(FA|CN)\d{6}$/.test(nr)) return null;
    return factuurBestand(nr);
  }

  return { voorProject, zet, bestand, _intern: { bereken } };
}

module.exports = { maakGeld, leesXlsx, leesOfferteDocx, klantPast, tokens, bedrag, leesBoekhouding };
