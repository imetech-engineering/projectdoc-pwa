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

/* ------------------------------------------------ offertes en facturen */

{
  const { maakGeld, klantPast, tokens } = require("../lib/geld");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const tr = (...c) => `<w:tr>${c.map((x) => `<w:tc>${p(x)}</w:tc>`).join("")}</w:tr>`;
  const doc = (inhoud) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${inhoud}</w:body></w:document>`;
  const schrijfDocx = (pad, inhoud) => {
    fs.mkdirSync(path.dirname(pad), { recursive: true });
    fs.writeFileSync(pad, schrijfZip([onderdeel("[Content_Types].xml", CONTENT_TYPES), onderdeel("word/document.xml", doc(inhoud))]));
  };
  const od = fs.mkdtempSync(path.join(os.tmpdir(), "projectdoc-geld-"));
  const pm = path.join(od, "04 Klanten & projecten");
  const projPad = path.join(pm, "50 IMeTech Engineering", "5016 Liftprint", "Project Liftprint.docx");
  schrijfDocx(projPad, p("Liftprint") + `<w:tbl>${tr("Projectnummer", "5016 │ Lift Techniek")}${tr("Start", "2026-02")}</w:tbl>` + p("260301  Start") + p("Offerte OF260301 verstuurd"));
  const anderPad = path.join(pm, "50 IMeTech Engineering", "5020 Robot", "Project Robot.docx");
  schrijfDocx(anderPad, p("Robot") + `<w:tbl>${tr("Projectnummer", "5020 │ Aluwi")}</w:tbl>`);
  const offerte = (nr, datum, klant, onderwerp, regels, excl) =>
    p(`Aan:\t${klant}`) +
    p(`Graag bieden we u hierbij de volgende offerte aan voor het project ${onderwerp}, zoals besproken.`) +
    `<w:tbl>${tr("Offertenummer", "Offertedatum", "Geldigheid", "Uw referentie")}${tr(nr, datum, "30 dagen", onderwerp)}</w:tbl>` +
    `<w:tbl>${tr("Omschrijving", "Prijs", "Aantal", "Subtotaal")}${regels.map(([o, b]) => tr(o, b, "1", b)).join("")}` +
    `${tr("Totaal excl. BTW", "", "", excl)}${tr("21% BTW", "", "", "€ 1,00")}${tr("Totaal", "", "", "€ 9,99")}</w:tbl>`;
  const om = path.join(od, "03 Offertes");
  schrijfDocx(path.join(om, "Archief", "OF260301_Lift Techniek.docx"), offerte("OF260301", "02-03-2026", "Lift Techniek B.V.", "Liftprint", [["Ontwerp", "€ 2.000,00"]], "€ 2.000,00"));
  schrijfDocx(path.join(om, "OF260904_Lift Techniek.docx"), offerte("OF260904", "16-09-2026", "Lift Techniek B.V.", "Liftprint serie 30", [["Materialen", "€ 3.000,00"], ["Werk", "€ 475,00"]], "€ 3.475,00"));
  schrijfDocx(path.join(om, "OF260904_Lift Techniek_backup_260916.docx"), offerte("OF260904", "01-09-2026", "X", "X", [], "€ 1,00"));
  schrijfDocx(path.join(om, "OF260905_Jessica Aluwi.docx"), offerte("OF260905", "21-09-2026", "Jessica Aluwi", "Geurmodule", [["Onderzoek", "€ 2.320,00"]], "€ 2.320,00"));
  fs.writeFileSync(path.join(om, "Archief", "OF250101_Oud.pdf"), "%PDF-1.4");

  // Mini-werkboek: Verkoopboek + Bankboek, met gedeelde strings zoals Excel dat doet.
  const strings = ["Factuurdatum", "Klant", "Omschrijving", "Factuurnr / Bon", "Bedrag incl. BTW (€)", "Netto (€)",
    "Lift Techniek", "5016 Liftprint (30% aanbetaling)", "FA260709", "5016 Liftprint restbetaling", "FA260906",
    "Datum", "In (€)", "Factuur", "Lift Techniek FA260709", "Onbekend", "Advies", "FA260910"];
  const sst = `<sst xmlns="x">${strings.map((t) => `<si><t>${t.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`;
  const c = (ref, v, s) => (s ? `<c r="${ref}" t="s"><v>${v}</v></c>` : `<c r="${ref}"><v>${v}</v></c>`);
  const vk = `<worksheet><sheetData>
    <row r="5">${c("A5", 0, 1)}${c("D5", 1, 1)}${c("E5", 2, 1)}${c("F5", 3, 1)}${c("G5", 4, 1)}${c("N5", 5, 1)}</row>
    <row r="6">${c("A6", 46223)}${c("D6", 6, 1)}${c("E6", 7, 1)}${c("F6", 8, 1)}${c("G6", 726)}${c("N6", 600)}</row>
    <row r="7">${c("A7", 46281)}${c("D7", 6, 1)}${c("E7", 9, 1)}${c("F7", 10, 1)}${c("G7", 1694)}${c("N7", 1400)}</row>
    <row r="8">${c("A8", 46286)}${c("D8", 15, 1)}${c("E8", 16, 1)}${c("F8", 17, 1)}${c("G8", 121)}${c("N8", 100)}</row>
  </sheetData></worksheet>`;
  const bb = `<worksheet><sheetData>
    <row r="5">${c("A5", 11, 1)}${c("B5", 2, 1)}${c("C5", 12, 1)}${c("I5", 13, 1)}</row>
    <row r="6">${c("A6", 46240)}${c("B6", 14, 1)}${c("C6", 726)}</row>
  </sheetData></worksheet>`;
  const wbXml = `<workbook xmlns:r="r"><sheets><sheet name="Bankboek" sheetId="1" r:id="rId1"/><sheet name="Verkoopboek totaal" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
  const bh = path.join(od, "02 Boekhouding");
  fs.mkdirSync(path.join(bh, "01 Verkoop facturen", "Facturen verkoop verwerkt"), { recursive: true });
  fs.writeFileSync(path.join(bh, "01 Verkoop facturen", "Facturen verkoop verwerkt", "FA260709_NL_Lift Techniek.pdf"), "%PDF-1.4");
  fs.writeFileSync(path.join(bh, "Boekhouding_IMeTech.xlsx"), schrijfZip([
    onderdeel("xl/workbook.xml", wbXml), onderdeel("xl/_rels/workbook.xml.rels", rels),
    onderdeel("xl/sharedStrings.xml", sst), onderdeel("xl/worksheets/sheet1.xml", bb), onderdeel("xl/worksheets/sheet2.xml", vk),
  ]));

  const projectLijst = [
    { naam: "Liftprint", map: "5016 Liftprint", pad: projPad },
    { naam: "Robot", map: "5020 Robot", pad: anderPad },
  ];
  const g = maakGeld({ projectenMap: pm, keuzesPad: path.join(od, "keuzes.json") });
  let r = g.voorProject("Liftprint", projectLijst);
  const o1 = r.offertes.find((o) => o.nummer === "OF260301");
  const o2 = r.offertes.find((o) => o.nummer === "OF260904");
  check("offertes aan het juiste project gekoppeld", r.offertes.length === 2 && !!o1 && !!o2);
  check("offerte-inhoud gelezen (regels, totaal, datum)", o2 && o2.regels.length === 2 && o2.totaalExcl === 3475 && o2.datum === "2026-09-16");
  check("backup-kopie van een offerte genegeerd", o2 && o2.klant === "Lift Techniek B.V.");
  check("facturen via projectnummer gekoppeld", r.facturen.length === 2);
  check("betaald volgt uit het Bankboek", r.facturen.find((f) => f.nummer === "FA260709").betaald && !r.facturen.find((f) => f.nummer === "FA260906").betaald);
  check("factuur hoort bij de oudste openstaande offerte", r.facturen.every((f) => f.offerte === "OF260301"));
  check("restbetaling rondt de offerte af", o1.status === "afgerond" && o2.status === "open");
  check("pdf van factuur gevonden", r.facturen.find((f) => f.nummer === "FA260709").heeftBestand);
  check("oude offerte zonder project staat bij de losse", r.losseOffertes.length === 0 || r.losseOffertes.every((o) => o.nummer !== "OF260904"));
  const robot = g.voorProject("Robot", projectLijst);
  check("klantnaam koppelt offerte aan ander project", robot.offertes.length === 1 && robot.offertes[0].nummer === "OF260905");
  check("factuur zonder duidelijke klant blijft los", robot.facturen.length === 0 && robot.losseFacturen.some((f) => f.nummer === "FA260910"));

  g.zet("offerte", "OF260904", { afgerond: true });
  g.zet("factuur", "FA260910", { project: "Liftprint" });
  g.zet("offerte", "OF260905", { project: "-" });
  r = g.voorProject("Liftprint", projectLijst);
  check("handmatig afronden werkt", r.offertes.find((o) => o.nummer === "OF260904").status === "afgerond");
  check("factuur handmatig koppelen werkt", r.facturen.some((f) => f.nummer === "FA260910" && f.koppeling === "handmatig"));
  check("offerte loskoppelen werkt", g.voorProject("Robot", projectLijst).offertes.length === 0);
  g.zet("offerte", "OF260904", { afgerond: null });
  check("terug naar automatisch", g.voorProject("Liftprint", projectLijst).offertes.find((o) => o.nummer === "OF260904").status !== "afgerond");
  check("bestand zoeken blijft binnen de mappen", g.bestand("offerte", "../../x") === null && /OF260904_Lift Techniek\.docx$/.test(g.bestand("offerte", "of260904")));
  check("klantnaam-vergelijking negeert rechtsvorm", klantPast("Lift Techniek B.V.", "50 imetech engineering 5016 liftprint 5016 lift techniek") && tokens("IMeTech Engineering B.V.").length === 0);
  fs.rmSync(od, { recursive: true, force: true });
}

console.log(`\n${mislukt ? `${mislukt} controle(s) mislukt` : "Alles in orde"}`);
process.exit(mislukt ? 1 : 0);
