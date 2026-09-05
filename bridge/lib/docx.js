/**
 * Lezen en bewerken van Project_[Naam].docx.
 *
 * Uitgangspunt: we schrijven geen nieuw document, we *voegen toe* aan het
 * bestaande. Nieuwe alinea's krijgen letterlijk de opmaakeigenschappen (w:pPr /
 * w:rPr) van een bestaande alinea van hetzelfde soort uit hetzelfde document.
 * Daarmee ziet een toegevoegde logboek-entry er precies zo uit als de rest,
 * zonder dat we lettertypes of stijlen hoeven te kennen.
 */
"use strict";

const fs = require("node:fs");
const { leesZip, pakUit, vervangOnderdeel, schrijfZip } = require("./zip");

const DOC = "word/document.xml";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ontEsc(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function regexNaam(naam) {
  return naam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Einde-positie (na de sluittag) van het element dat op `start` begint. */
function eindVanElement(xml, start, naam) {
  const re = new RegExp(`<\\/?${regexNaam(naam)}(?=[\\s/>])`, "g");
  re.lastIndex = start;
  let diepte = 0;
  let m;
  while ((m = re.exec(xml))) {
    const gt = xml.indexOf(">", m.index);
    if (gt < 0) break;
    const isSluit = m[0][1] === "/";
    const zelfSluitend = !isSluit && xml[gt - 1] === "/";
    if (isSluit) {
      diepte--;
      if (diepte <= 0) return gt + 1;
    } else if (zelfSluitend) {
      if (diepte === 0) return gt + 1;
    } else {
      diepte++;
    }
    re.lastIndex = gt + 1;
  }
  throw new Error(`Geen sluittag gevonden voor ${naam}`);
}

/** Directe kinderen van <w:body>, in volgorde. */
function bodyKinderen(xml) {
  const bodyOpen = xml.indexOf("<w:body");
  if (bodyOpen < 0) throw new Error("Geen <w:body> in document.xml");
  const start = xml.indexOf(">", bodyOpen) + 1;
  const eind = xml.lastIndexOf("</w:body>");
  const kinderen = [];
  let i = start;
  while (i < eind) {
    const punt = xml.indexOf("<", i);
    if (punt < 0 || punt >= eind) break;
    const m = /^<([a-zA-Z0-9:_.-]+)/.exec(xml.slice(punt, punt + 80));
    if (!m) break;
    const naam = m[1];
    const e = eindVanElement(xml, punt, naam);
    kinderen.push({ naam, start: punt, eind: e, xml: xml.slice(punt, e) });
    i = e;
  }
  return { kinderen, bodyStart: start, bodyEind: eind };
}

/** Eerste element `naam` binnen `fragment`, inclusief tags. */
function pakElement(fragment, naam) {
  const re = new RegExp(`<${regexNaam(naam)}(?=[\\s/>])`);
  const m = re.exec(fragment);
  if (!m) return null;
  return fragment.slice(m.index, eindVanElement(fragment, m.index, naam));
}

/** Alle elementen `naam` op willekeurig niveau binnen `fragment`. */
function pakAlle(fragment, naam) {
  const re = new RegExp(`<${regexNaam(naam)}(?=[\\s/>])`, "g");
  const uit = [];
  let m;
  while ((m = re.exec(fragment))) {
    const e = eindVanElement(fragment, m.index, naam);
    uit.push(fragment.slice(m.index, e));
    re.lastIndex = e;
  }
  return uit;
}

/** Leesbare tekst van één alinea (tabs en regelovergangen meegenomen). */
function alineaTekst(pXml) {
  let uit = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let m;
  while ((m = re.exec(pXml))) {
    if (m[1] !== undefined) uit += ontEsc(m[1]);
    else if (m[0].startsWith("<w:tab")) uit += "\t";
    else uit += "\n";
  }
  return uit;
}

function isBullet(pXml) {
  if (/<w:numPr(?=[\s/>])/.test(pXml)) return true;
  // Word zet opsommingen soms alleen via een lijststijl, zonder eigen numPr.
  const m = /<w:pStyle\s[^>]*w:val="([^"]+)"/.exec(pXml);
  return !!m && /list|lijst|bullet|opsom/i.test(m[1]);
}

function isVet(pXml) {
  const run = pakElement(pXml, "w:r");
  if (!run) return false;
  const rPr = pakElement(run, "w:rPr");
  return !!rPr && /<w:b(?=[\s/>])/.test(rPr);
}

/** Hele document als platte tekst — dit is wat Claude te lezen krijgt. */
function documentTekst(xml) {
  const { kinderen } = bodyKinderen(xml);
  const regels = [];
  for (const kind of kinderen) {
    if (kind.naam === "w:p") {
      const t = alineaTekst(kind.xml);
      if (!t.trim()) {
        regels.push("");
        continue;
      }
      regels.push(isBullet(kind.xml) ? `- ${t}` : t);
    } else if (kind.naam === "w:tbl") {
      for (const rij of pakAlle(kind.xml, "w:tr")) {
        const cellen = pakAlle(rij, "w:tc").map((c) =>
          pakAlle(c, "w:p").map(alineaTekst).join(" ").trim()
        );
        regels.push(cellen.join("\t"));
      }
      regels.push("");
    }
  }
  return regels.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Labels en waarden uit de kopdtabel (Projectnummer, Start, Uurtarief, ...). */
function headerVelden(xml) {
  const { kinderen } = bodyKinderen(xml);
  const tabel = kinderen.find((k) => k.naam === "w:tbl");
  if (!tabel) return [];
  return pakAlle(tabel.xml, "w:tr")
    .map((rij) => {
      const cellen = pakAlle(rij, "w:tc").map((c) =>
        pakAlle(c, "w:p").map(alineaTekst).join(" ").trim()
      );
      return { label: (cellen[0] || "").replace(/:$/, "").trim(), waarde: cellen[1] || "" };
    })
    .filter((r) => r.label);
}

/**
 * Waar begint het logboek? Direct na de kop-tabel, en na een eventuele lege
 * alinea of een losse "Logboek"-kop die daar staat.
 */
function logboekStart(kinderen) {
  const tabelIndex = kinderen.findIndex((k) => k.naam === "w:tbl");
  let i = tabelIndex >= 0 ? tabelIndex + 1 : 0;
  while (i < kinderen.length && kinderen[i].naam === "w:p") {
    const t = alineaTekst(kinderen[i].xml).trim();
    if (t === "" || /^logboek:?$/i.test(t)) i++;
    else break;
  }
  return i;
}

/** Bestaande alinea's die als opmaak-voorbeeld dienen voor nieuwe regels. */
function sjablonen(kinderen, vanaf) {
  const alineas = kinderen.slice(vanaf).filter((k) => k.naam === "w:p");
  const metTekst = alineas.filter((p) => alineaTekst(p.xml).trim());
  return {
    kop: metTekst.find((p) => isVet(p.xml) && !isBullet(p.xml))?.xml || null,
    tekst: metTekst.find((p) => !isVet(p.xml) && !isBullet(p.xml))?.xml || null,
    bullet: metTekst.find((p) => isBullet(p.xml))?.xml || null,
    leeg: alineas.find((p) => !alineaTekst(p.xml).trim())?.xml || null,
  };
}

/** Bouwt een nieuwe alinea met de opmaak van `sjabloon`. */
function alineaUitSjabloon(sjabloon, tekst, opties = {}) {
  const pPr = sjabloon ? pakElement(sjabloon, "w:pPr") || "" : "";
  const eersteRun = sjabloon ? pakElement(sjabloon, "w:r") : null;
  let rPr = eersteRun ? pakElement(eersteRun, "w:rPr") || "" : "";
  if (opties.vet && !/<w:b(?=[\s/>])/.test(rPr)) {
    rPr = rPr ? rPr.replace("<w:rPr>", "<w:rPr><w:b/>") : "<w:rPr><w:b/></w:rPr>";
  }
  if (!String(tekst).length) return `<w:p>${pPr}</w:p>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(tekst)}</w:t></w:r></w:p>`;
}

/**
 * Zet een entry-object om in alinea-XML.
 * entry = { kop, alineas: [...], secties: [{ kop, punten: [...] }] }
 */
function entryNaarXml(entry, sj) {
  const delen = [];
  const kopSjabloon = sj.kop || sj.tekst;
  delen.push(alineaUitSjabloon(kopSjabloon, entry.kop, { vet: true }));
  for (const alinea of entry.alineas || []) {
    if (alinea && alinea.trim()) delen.push(alineaUitSjabloon(sj.tekst || sj.kop, alinea.trim()));
  }
  for (const sectie of entry.secties || []) {
    if (sectie.kop) {
      delen.push(alineaUitSjabloon(kopSjabloon, sectie.kop.replace(/:$/, "") + ":", { vet: true }));
    }
    for (const punt of sectie.punten || []) {
      if (!punt || !punt.trim()) continue;
      if (sj.bullet) delen.push(alineaUitSjabloon(sj.bullet, punt.trim()));
      else delen.push(alineaUitSjabloon(sj.tekst, `- ${punt.trim()}`));
    }
  }
  delen.push(alineaUitSjabloon(sj.leeg || sj.tekst, ""));
  return delen.join("");
}

/** Voegt de entry bovenaan het logboek toe (nieuwste eerst). */
function voegEntryToe(xml, entry) {
  const { kinderen } = bodyKinderen(xml);
  const index = logboekStart(kinderen);
  const sj = sjablonen(kinderen, index);
  const invoegPositie =
    index < kinderen.length ? kinderen[index].start : kinderen[kinderen.length - 1]?.start ?? xml.lastIndexOf("</w:body>");
  return xml.slice(0, invoegPositie) + entryNaarXml(entry, sj) + xml.slice(invoegPositie);
}

/** Vervangt de waarde in de kop-tabel bij `label`. Geeft null als het label ontbreekt. */
function zetHeaderWaarde(xml, label, waarde) {
  const { kinderen } = bodyKinderen(xml);
  const tabel = kinderen.find((k) => k.naam === "w:tbl");
  if (!tabel) return null;
  const doel = label.toLowerCase().replace(/:$/, "").trim();

  let positie = tabel.start;
  const rijen = pakAlle(tabel.xml, "w:tr");
  for (const rij of rijen) {
    const rijStart = xml.indexOf(rij, positie);
    positie = rijStart + rij.length;
    const cellen = pakAlle(rij, "w:tc");
    if (cellen.length < 2) continue;
    const labelTekst = pakAlle(cellen[0], "w:p").map(alineaTekst).join(" ").replace(/:$/, "").trim();
    if (labelTekst.toLowerCase() !== doel) continue;

    const waardeCel = cellen[1];
    const celStart = xml.indexOf(waardeCel, rijStart);
    const tcPr = pakElement(waardeCel, "w:tcPr") || "";
    const sjabloonP = pakElement(waardeCel, "w:p");
    const nieuweCel = `<w:tc>${tcPr}${alineaUitSjabloon(sjabloonP, waarde)}</w:tc>`;
    return xml.slice(0, celStart) + nieuweCel + xml.slice(celStart + waardeCel.length);
  }
  return null;
}

/** Verwijdert alle logboek-alinea's — voor het opzetten van een nieuw project. */
function leegLogboek(xml) {
  const { kinderen, bodyEind } = bodyKinderen(xml);
  const index = logboekStart(kinderen);
  if (index >= kinderen.length) return xml;
  const sectie = kinderen.slice(index).find((k) => k.naam === "w:sectPr");
  const knip = kinderen[index].start;
  return xml.slice(0, knip) + xml.slice(sectie ? sectie.start : bodyEind);
}

/** Vervangt de tekst van de eerste gevulde alinea (de documenttitel). */
function zetTitel(xml, tekst) {
  const { kinderen } = bodyKinderen(xml);
  const eerste = kinderen.find((k) => k.naam === "w:p" && alineaTekst(k.xml).trim());
  if (!eerste) return xml;
  return xml.slice(0, eerste.start) + alineaUitSjabloon(eerste.xml, tekst) + xml.slice(eerste.eind);
}

function open(pad) {
  const onderdelen = leesZip(fs.readFileSync(pad));
  const doc = onderdelen.find((o) => o.naam === DOC);
  if (!doc) throw new Error(`${pad} bevat geen ${DOC}`);
  return { onderdelen, xml: pakUit(doc).toString("utf8") };
}

function bewaar(pad, onderdelen, xml) {
  const nieuw = vervangOnderdeel(onderdelen, DOC, Buffer.from(xml, "utf8"));
  fs.writeFileSync(pad, schrijfZip(nieuw));
}

module.exports = {
  open,
  bewaar,
  documentTekst,
  headerVelden,
  voegEntryToe,
  zetHeaderWaarde,
  leegLogboek,
  zetTitel,
  alineaTekst,
  bodyKinderen,
  pakElement,
  pakAlle,
};
