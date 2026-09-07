/**
 * Zelftest van het docx-werk, zonder Claude en zonder internet.
 * Bouwt een miniatuur-Word-document, voegt er een entry aan toe en
 * controleert dat het resultaat nog een geldige zip is met de juiste inhoud.
 *
 *   node test/test.js
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { schrijfZip, leesZip, crc32 } = require("../lib/zip");
const docx = require("../lib/docx");
const { SCHEMA_VOORSTEL } = require("../lib/prompts");

let mislukt = 0;
function check(omschrijving, waar) {
  console.log(`${waar ? "  ok  " : "MIS   "} ${omschrijving}`);
  if (!waar) mislukt++;
}

/* --------------------------------------------- miniatuur-docx samenstellen */

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function alinea(tekst, { vet = false, bullet = false } = {}) {
  const pPr = bullet ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : "";
  const rPr = vet ? "<w:rPr><w:b/></w:rPr>" : "";
  if (!tekst) return `<w:p>${pPr}</w:p>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${tekst}</w:t></w:r></w:p>`;
}

function rij(label, waarde) {
  return (
    `<w:tr><w:tc><w:tcPr/>${alinea(label, { vet: true })}</w:tc>` +
    `<w:tc><w:tcPr/>${alinea(waarde)}</w:tc></w:tr>`
  );
}

const DOCUMENT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>` +
  alinea("Testproject — proefopstelling", { vet: true }) +
  "<w:tbl>" +
  rij("Start", "2026-08 | Status: Actief") +
  rij("Uren inschatting", "40 uur | Gemaakte uren: 12") +
  "</w:tbl>" +
  alinea("") +
  alinea("Logboek", { vet: true }) +
  alinea("260812 Startgesprek — scope vastgelegd", { vet: true }) +
  alinea("Telefonisch overleg over de opzet.") +
  alinea("Acties IM:", { vet: true }) +
  alinea("Offerte opstellen", { bullet: true }) +
  alinea("") +
  "<w:sectPr/></w:body></w:document>";

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

function onderdeel(naam, tekst) {
  const bytes = Buffer.from(tekst, "utf8");
  return {
    naam,
    vlaggen: 0,
    methode: 0,
    modTijd: 0,
    modDatum: 0,
    crc: crc32(bytes),
    ruweGrootte: bytes.length,
    externeAttr: 0,
    data: bytes,
  };
}

const map = fs.mkdtempSync(path.join(os.tmpdir(), "projectdoc-test-"));
const pad = path.join(map, "Project_Test.docx");
fs.writeFileSync(
  pad,
  schrijfZip([onderdeel("[Content_Types].xml", CONTENT_TYPES), onderdeel("word/document.xml", DOCUMENT)])
);

/* ------------------------------------------------------------------ tests */

console.log("Zelftest projectdoc-bridge\n");

let { onderdelen, xml } = docx.open(pad);
const tekst = docx.documentTekst(xml);
check("document laat zich lezen", tekst.includes("Startgesprek"));
check("opsommingsteken herkend", tekst.includes("- Offerte opstellen"));

const header = docx.headerVelden(xml);
check("kopgegevens gevonden", header.length === 2 && header[1].label === "Uren inschatting");

let nieuw = docx.zetHeaderWaarde(xml, "Uren inschatting", "40 uur | Gemaakte uren: 15");
check("kopwaarde bijgewerkt", !!nieuw && docx.headerVelden(nieuw)[1].waarde.endsWith("15"));
check("onbekend kopveld geeft null", docx.zetHeaderWaarde(xml, "Bestaat niet", "x") === null);

nieuw = docx.voegEntryToe(nieuw, {
  kop: "260905 Bezoek — opstelling draait",
  alineas: ["Eerste meting gedaan; signaal stabiel tot 180 Hz."],
  secties: [{ kop: "Acties IM", punten: ["Rapport schrijven", "Sensor bestellen"] }],
});

const uitPad = path.join(map, "uit.docx");
docx.bewaar(uitPad, onderdelen, nieuw);

const opnieuw = docx.open(uitPad);
const uitTekst = docx.documentTekst(opnieuw.xml);
const regels = uitTekst.split("\n").filter((r) => /^\d{6}\s/.test(r));
check("bestand na opslaan weer leesbaar", uitTekst.includes("Bezoek — opstelling draait"));
check("nieuwe entry staat bovenaan", regels[0].startsWith("260905"));
check("oude entry blijft staan", regels[1].startsWith("260812"));
check("opsommingspunten toegevoegd", uitTekst.includes("- Rapport schrijven"));
check("kopgegeven meegeschreven", docx.headerVelden(opnieuw.xml)[1].waarde.endsWith("15"));

const nietGewijzigd = opnieuw.onderdelen.find((o) => o.naam === "[Content_Types].xml");
check("ongewijzigd onderdeel bleef intact", nietGewijzigd.ruweGrootte === Buffer.byteLength(CONTENT_TYPES));
check("zip bevat beide onderdelen", leesZip(fs.readFileSync(uitPad)).length === 2);

const leeg = docx.leegLogboek(opnieuw.xml);
check("logboek legen laat de kop staan", docx.documentTekst(leeg).includes("Uren inschatting"));
check("logboek legen haalt entries weg", !docx.documentTekst(leeg).includes("260905"));

check("zip bevat geen zip64-velden", fs.readFileSync(uitPad).indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])) === -1);

// Het schema gaat als één argument mee op de opdrachtregel. Staat er een spatie
// in, dan knipt de Windows-opdrachtprompt het af en krijg je "Expected '}'".
const schemaTekst = JSON.stringify(SCHEMA_VOORSTEL);
check("JSON-schema bevat geen witruimte", !/\s/.test(schemaTekst));

fs.rmSync(map, { recursive: true, force: true });

console.log(`\n${mislukt ? `${mislukt} controle(s) mislukt` : "Alles in orde"}`);
process.exit(mislukt ? 1 : 0);
