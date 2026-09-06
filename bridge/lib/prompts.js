/**
 * De teksten die naar Claude gaan. Bewust in één bestand, zodat de stijlregels
 * van het logboek op één plek staan en makkelijk bij te schaven zijn.
 */
"use strict";

function stijlregels(schrijver, initialen) {
  return `Je schrijft in de stijl van ${schrijver}, zoals in de bestaande logboeken:
- Nederlands, kort en feitelijk. Geen opsmuk, geen marketingtaal, geen inleidende zinnen.
- Derde persoon verleden tijd voor wat er gebeurd is; gebiedende wijs voor actiepunten.
- Getallen (uren, bedragen, data, frequenties, typenummers) altijd letterlijk overnemen.
- Verzin niets. Wat niet in de invoer staat, komt niet in de entry.

Opbouw van een entry:
- Kop: "JJMMDD Korte titel — kernresultaat". JJMMDD is de datum van de gebeurtenis (6 cijfers).
- Daarna 1 tot 3 zinnen vrije tekst: wie, wat, waarom, uitkomst.
- Daarna eventueel secties met een korte kop en opsommingspunten. Gebruikelijke koppen:
  "Uitgevoerde werkzaamheden", "Niet uitgevoerd", "Afspraken", "Acties IM",
  "Acties ${initialen}" (de schrijver zelf), "Acties <naam>". Bij een bezoek kan
  een eerste alinea beginnen met "Aanwezig: ..." of "Tijdsduur: ...".
- Alleen secties opnemen die er echt zijn. Liever geen sectie dan een lege.`;
}

const SCHEMA_VOORSTEL = {
  type: "object",
  properties: {
    duplicaat: { type: "boolean" },
    duplicaatToelichting: { type: "string" },
    entry: {
      type: "object",
      properties: {
        kop: { type: "string" },
        alineas: { type: "array", items: { type: "string" } },
        secties: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kop: { type: "string" },
              punten: { type: "array", items: { type: "string" } },
            },
            required: ["kop", "punten"],
            additionalProperties: false,
          },
        },
      },
      required: ["kop", "alineas", "secties"],
      additionalProperties: false,
    },
    headerWijzigingen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          nieuweWaarde: { type: "string" },
          reden: { type: "string" },
        },
        required: ["label", "nieuweWaarde", "reden"],
        additionalProperties: false,
      },
    },
    vragen: { type: "array", items: { type: "string" } },
  },
  required: ["duplicaat", "duplicaatToelichting", "entry", "headerWijzigingen", "vragen"],
  additionalProperties: false,
};

const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

function vandaag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const kort = (x) => `${String(x.getFullYear()).slice(2)}${p(x.getMonth() + 1)}${p(x.getDate())}`;
  const gisteren = new Date(d.getTime() - 86400000);
  return {
    iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    kort: kort(d),
    dag: DAGEN[d.getDay()],
    gisterenKort: kort(gisteren),
    gisterenDag: DAGEN[gisteren.getDay()],
  };
}

function historieBlok(historie) {
  if (!historie || !historie.length) return "";
  const regels = historie
    .slice(-6)
    .map((b) => `${b.rol === "ik" ? "Gebruiker" : "Jij"}: ${b.tekst}`)
    .join("\n\n");
  return `\n\n<eerder_in_dit_gesprek>\n${regels}\n</eerder_in_dit_gesprek>`;
}

/** Vraag over een project — puur lezen, geen wijzigingen. */
function vraagPrompt({ projectNaam, documentTekst, vraag, historie }) {
  const d = vandaag();
  return `Je beantwoordt vragen over projectdocumentatie. Vandaag is ${d.iso}.

Hieronder staat de volledige inhoud van het projectdocument "${projectNaam}". Beantwoord de vraag alleen op basis van dit document. Weet je het niet uit dit document, zeg dat dan gewoon.

Antwoord in het Nederlands, kort en direct — dit wordt op een telefoon gelezen en soms hardop voorgelezen. Geen opsommingen tenzij het echt een lijstje is. Noem waar relevant de datum van de logboek-entry waar het antwoord vandaan komt.

<projectdocument naam="${projectNaam}">
${documentTekst}
</projectdocument>${historieBlok(historie)}

<vraag>
${vraag}
</vraag>`;
}

/** Voorstel voor een nieuwe logboek-entry. */
function voorstelPrompt({ projectNaam, documentTekst, headerVelden, notities, historie, schrijver, initialen }) {
  const d = vandaag();
  const header = headerVelden.map((v) => `- ${v.label}: ${v.waarde}`).join("\n") || "(geen kop-tabel gevonden)";
  return `Je maakt een logboek-entry voor het projectdocument "${projectNaam}". Vandaag is ${d.dag} ${d.iso} (JJMMDD: ${d.kort}); gisteren was ${d.gisterenDag} (JJMMDD: ${d.gisterenKort}).

${stijlregels(schrijver, initialen)}

<huidige_kopgegevens>
${header}
</huidige_kopgegevens>

<bestaand_document>
${documentTekst}
</bestaand_document>${historieBlok(historie)}

<ruwe_notities>
${notities}
</ruwe_notities>

Notities worden vaak pas later ingesproken en noemen dan een dag in plaats van een datum ("gisteren", "afgelopen maandag", "vorige week donderdag"). Reken die om naar de echte datum en gebruik die in de kop. Staat er geen dag bij, dan is het vandaag.

De notities zijn van de schrijver zelf en komen vaak uit spraakherkenning: leestekens ontbreken, namen en vaktermen kunnen verhaspeld zijn. Corrigeer wat je met zekerheid uit de projectcontext kunt afleiden. Twijfel je over iets dat de betekenis verandert (een bedrag, een aantal uren, een toezegging, een naam), corrigeer het dan NIET maar zet er een korte vraag over in "vragen".

Controleer eerst op dubbelen: staat deze gebeurtenis al in het logboek (zelfde datum én zelfde inhoud)? Zet dan duplicaat op true en leg in duplicaatToelichting uit welke bestaande entry het is. Gaat het om aanvullende informatie bij een dag die al voorkomt, dan is het geen duplicaat: maak een eigen nieuwe entry.

Kopgegevens pas je alleen aan als de notities daar duidelijk aanleiding toe geven:
- een statuswijziging ("akkoord", "afgerond", "on hold") → het veld dat de status bevat
- gewerkte uren → tel op bij het bestaande aantal, overschrijf nooit
- een gewijzigd uurtarief, nieuw ordernummer of andere contactpersoon
Geef bij een wijziging altijd de VOLLEDIGE nieuwe waarde van dat veld, in exact dezelfde opmaak als de huidige waarde. Is er niets te wijzigen, dan is headerWijzigingen een lege lijst.`;
}

module.exports = { vraagPrompt, voorstelPrompt, SCHEMA_VOORSTEL, stijlregels, vandaag };
