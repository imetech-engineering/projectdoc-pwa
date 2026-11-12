/**
 * Projectdocumenten in Markdown (`Project <Naam>.md`), sinds november 2026.
 *
 *   ---
 *   projectnummer: 5016
 *   project: Custom PCB PRM-lift
 *   status: ...
 *   ---
 *
 *   # Titel
 *
 *   ## Bestellingen
 *   | Datum | Leverancier | Ordernr | Wat | Bedrag | Status |
 *   |---|---|---|---|---|---|
 *
 *   ## Logboek
 *
 *   ### 261111  Titel
 *   tekst, - punten, **Acties IM:**
 *
 * Alles hier is pure tekstbewerking; bestanden lezen/schrijven gebeurt in
 * projectdoc.js. Dezelfde opzet als app/projectdoc_md.py in de assistent.
 */
"use strict";

const FM = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ENTRYKOP = /^#{2,4}[ \t]+(\d{6})[ \t]+(.+?)\s*$/;
const BESTELKOLOMMEN = ["datum", "leverancier", "ordernr", "wat", "bedrag", "status"];
const BESTELKOP = "| Datum | Leverancier | Ordernr | Wat | Bedrag | Status |";
const BESTELSEP = "|---|---|---|---|---|---|";

/* Labels zoals de app en de prompts ze kennen <-> sleutels in de frontmatter */
const LABELS = {
  projectnummer: "Projectnummer",
  project: "Project",
  klant: "Klant",
  contactpersoon: "Contactpersoon",
  locatie: "Locatie",
  start: "Start",
  status: "Status",
  uurtarief: "Uurtarief",
  uren_inschatting: "Uren inschatting",
  uren_gemaakt: "Gemaakte uren",
  offerte: "Offerte",
  omschrijving: "Omschrijving",
};
const SLEUTEL_VAN = {
  "gemaakte uren": "uren_gemaakt",
  "uren gemaakt": "uren_gemaakt",
  "ureninschatting": "uren_inschatting",
  "contact": "contactpersoon",
  "opdrachtgever": "klant",
};

function sleutelVan(label) {
  const l = String(label || "").toLowerCase().replace(/:$/, "").trim();
  if (SLEUTEL_VAN[l]) return SLEUTEL_VAN[l];
  for (const [k, v] of Object.entries(LABELS)) if (v.toLowerCase() === l) return k;
  return l.replace(/[^a-z0-9à-ÿ]+/g, "_").replace(/^_|_$/g, "");
}

function labelVan(sleutel) {
  return LABELS[sleutel] || sleutel.charAt(0).toUpperCase() + sleutel.slice(1).replace(/_/g, " ");
}

/* ------------------------------------------------------------ frontmatter */

function yamlLees(v) {
  v = v.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch (_) {
      return v.slice(1, v.endsWith('"') ? -1 : undefined);
    }
  }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  return v;
}

function yamlWaarde(v) {
  v = String(v ?? "").replace(/\r?\n/g, " ").trim();
  if (v === "") return '""';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (
    /(:\s|\s#|^[-?:,\[\]{}#&*!|>'"%@`]|:$)/.test(v) ||
    ["ja", "nee", "yes", "no", "true", "false", "null", "on", "off", "y", "n", "~"].includes(v.toLowerCase())
  ) {
    return JSON.stringify(v);
  }
  return v;
}

/** [{sleutel, label, waarde}] in de volgorde van het bestand. */
function kopVelden(tekst) {
  const m = FM.exec(tekst);
  if (!m) return [];
  const uit = [];
  for (const regel of m[1].split(/\r?\n/)) {
    const r = /^([A-Za-z0-9_\-À-ÿ ]+?)[ \t]*:(?:[ \t]+(.*))?$/.exec(regel);
    if (!r) continue;
    const sleutel = r[1].trim().toLowerCase();
    uit.push({ sleutel, label: labelVan(sleutel), waarde: yamlLees(r[2] || "") });
  }
  return uit;
}

function headerVelden(tekst) {
  return kopVelden(tekst).map(({ label, waarde }) => ({ label, waarde }));
}

/** Zet (of voegt toe) één kopveld; de rest blijft letterlijk staan. */
function zetHeaderWaarde(tekst, label, waarde) {
  const sleutel = sleutelVan(label);
  if (!sleutel) return null;
  const regel = `${sleutel}: ${yamlWaarde(waarde)}`;
  const m = FM.exec(tekst);
  if (!m) return `---\n${regel}\n---\n\n${tekst}`;
  let blok = m[1];
  const re = new RegExp(`^${sleutel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*:.*$`, "m");
  blok = re.test(blok) ? blok.replace(re, () => regel) : `${blok}\n${regel}`;
  return `---\n${blok}\n---\n` + tekst.slice(m[0].length);
}

/* ---------------------------------------------------------------- secties */

function sectie(tekst, naam) {
  const kop = new RegExp(`^##[ \\t]+${naam}[ \\t]*$`, "mi").exec(tekst);
  if (!kop) return null;
  const begin = kop.index + kop[0].length;
  const volgende = /^##[ \t]+\S/m.exec(tekst.slice(begin));
  return { kopStart: kop.index, begin, eind: volgende ? begin + volgende.index : tekst.length };
}

function cellen(regel) {
  let r = regel.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function bestellingen(tekst) {
  const s = sectie(tekst, "Bestellingen");
  if (!s) return [];
  const uit = [];
  for (const regel of tekst.slice(s.begin, s.eind).split(/\r?\n/)) {
    const r = regel.trim();
    if (!r.startsWith("|") || /^\|[ \t]*:?-/.test(r)) continue;
    const c = cellen(r);
    if ((c[0] || "").toLowerCase() === "datum") continue;
    const rij = {};
    BESTELKOLOMMEN.forEach((k, i) => (rij[k] = c[i] || ""));
    uit.push(rij);
  }
  return uit;
}

function bestelRij(b) {
  return (
    "| " +
    BESTELKOLOMMEN.map((k) => String(b[k] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()).join(" | ") +
    " |"
  );
}

/** Regel bovenaan de tabel (nieuwste eerst); maakt de sectie aan vóór het Logboek als die ontbreekt. */
function voegBestellingToe(tekst, b) {
  const s = sectie(tekst, "Bestellingen");
  if (!s) {
    const blok = `## Bestellingen\n\n${BESTELKOP}\n${BESTELSEP}\n${bestelRij(b)}\n\n`;
    const lb = sectie(tekst, "Logboek");
    if (lb) return tekst.slice(0, lb.kopStart) + blok + tekst.slice(lb.kopStart);
    return tekst.replace(/\s*$/, "\n\n") + blok;
  }
  const inhoud = tekst.slice(s.begin, s.eind);
  const sep = /^\|[ \t]*:?-[-| \t:]*$/m.exec(inhoud);
  if (!sep) {
    const nieuw = `\n\n${BESTELKOP}\n${BESTELSEP}\n${bestelRij(b)}\n` + inhoud.replace(/^\n+/, "");
    return tekst.slice(0, s.begin) + nieuw + tekst.slice(s.eind);
  }
  const pos = s.begin + sep.index + sep[0].length;
  return tekst.slice(0, pos) + "\n" + bestelRij(b) + tekst.slice(pos);
}

/* ---------------------------------------------------------------- logboek */

function kaal(t) {
  return t
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s{2,}$/g, "")
    .trim();
}

/** Zelfde vorm als docx.logboekEntries: {datum, kop, blokken:[{soort, tekst}]}, nieuwste eerst. */
function logboekEntries(tekst, max = 60) {
  const lijf = tekst.replace(FM, "");
  const entries = [];
  let huidig = null;
  let inLogboek = !/^##[ \t]+Logboek/im.test(lijf); // geen Logboek-kop: overal entries zoeken
  for (const regel of lijf.split(/\r?\n/)) {
    if (/^##[ \t]+Logboek[ \t]*$/i.test(regel)) {
      inLogboek = true;
      continue;
    }
    const e = ENTRYKOP.exec(regel);
    if (e) {
      if (huidig) entries.push(huidig);
      huidig = { datum: e[1], kop: e[2].trim(), blokken: [] };
      continue;
    }
    if (/^##[ \t]+\S/.test(regel)) {
      // nieuwe sectie (bijv. Technische referentie) sluit de entry af
      if (huidig) entries.push(huidig);
      huidig = null;
      inLogboek = false;
      continue;
    }
    if (!huidig || !inLogboek) continue;
    const t = regel.trim();
    if (!t || /^\|[ \t]*:?-/.test(t)) continue;
    let m;
    if ((m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(regel))) huidig.blokken.push({ soort: "punt", tekst: kaal(m[1]) });
    else if ((m = /^#{3,6}\s+(.*)$/.exec(t))) huidig.blokken.push({ soort: "kop", tekst: kaal(m[1]) });
    else if (/^\*\*[^*].*\*\*:?$/.test(t)) huidig.blokken.push({ soort: "kop", tekst: kaal(t) });
    else if (t.startsWith("|")) huidig.blokken.push({ soort: "tekst", tekst: cellen(t).map(kaal).join(" · ") });
    else huidig.blokken.push({ soort: "tekst", tekst: kaal(t) });
  }
  if (huidig) entries.push(huidig);
  entries.sort((a, b) => b.datum.localeCompare(a.datum));
  return entries.slice(0, max);
}

function normaalKop(kop) {
  const m = /^(\d{6})\s+(.+)$/.exec(String(kop || "").trim());
  return m ? `${m[1]}  ${m[2].replace(/\s+/g, " ").trim()}` : String(kop || "").replace(/\s+/g, " ").trim();
}

/** Entry zoals Claude hem voorstelt ({kop, alineas, secties}) als Markdown. */
function entryNaarMd(entry) {
  const delen = [`### ${normaalKop(entry.kop)}`];
  for (const a of entry.alineas || []) if (a && a.trim()) delen.push(a.trim());
  for (const s of entry.secties || []) {
    const punten = (s.punten || []).filter((p) => p && p.trim()).map((p) => `- ${p.trim().replace(/^[-•]\s*/, "")}`);
    if (s.kop && s.kop.trim()) delen.push(`**${s.kop.trim().replace(/:$/, "")}:**`);
    if (punten.length) delen.push(punten.join("\n"));
  }
  return delen.join("\n\n") + "\n";
}

/** Bovenaan het logboek (nieuwste eerst); maakt '## Logboek' aan als die ontbreekt. */
function voegEntryToe(tekst, entry) {
  const blok = entryNaarMd(entry);
  const m = /^##[ \t]+Logboek[ \t]*$/im.exec(tekst);
  if (!m) return tekst.replace(/\s*$/, "\n\n") + "## Logboek\n\n" + blok;
  const na = tekst.slice(m.index + m[0].length).replace(/^\n+/, "");
  return tekst.slice(0, m.index + m[0].length) + "\n\n" + blok + (na ? "\n" + na : "");
}

/** Leeg nieuw projectdocument. */
function nieuwDocument({ titel, header = {} }) {
  const velden = Object.entries(header).filter(([, v]) => String(v ?? "").trim());
  const fm = velden.map(([label, v]) => `${sleutelVan(label)}: ${yamlWaarde(v)}`).join("\n");
  return `---\n${fm}\n---\n\n# ${titel}\n\n## Bestellingen\n\n${BESTELKOP}\n${BESTELSEP}\n\n## Logboek\n`;
}

module.exports = {
  headerVelden,
  kopVelden,
  zetHeaderWaarde,
  logboekEntries,
  bestellingen,
  voegBestellingToe,
  voegEntryToe,
  entryNaarMd,
  nieuwDocument,
  sleutelVan,
  yamlWaarde,
};
