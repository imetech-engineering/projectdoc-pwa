/**
 * Zoekt in je eigen postvak naar berichten die bij een project horen.
 *
 * Alleen lezen, alleen jouw postvak, en alleen wat bij het gekozen project
 * past: het mailadres van de contactpersoon uit de kop-tabel, en de naam van
 * het project of bedrijf. De gevonden berichten gaan als context mee naar
 * Claude; hij zoekt zelf niets op.
 */
"use strict";

const { graph, gekoppeld } = require("./graph");

const VELDEN = "id,subject,from,toRecipients,receivedDateTime,webLink,bodyPreview,body";

/** Losse mailadressen uit de kopgegevens van het project. */
function adressenUit(headerVelden) {
  const uit = new Set();
  for (const veld of headerVelden || []) {
    for (const treffer of String(veld.waarde).matchAll(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g)) {
      const adres = treffer[0].toLowerCase();
      // Je eigen adressen leveren alleen ruis op; die zitten in elk bericht.
      if (!/@imetech\./i.test(adres)) uit.add(adres);
    }
  }
  return [...uit];
}

/** Zoektermen: eerst de adressen, daarna de project- en bedrijfsnaam. */
function zoektermen(projectNaam, headerVelden) {
  const termen = adressenUit(headerVelden).map((a) => ({ soort: "adres", waarde: a }));
  const namen = new Set();
  if (projectNaam) namen.add(projectNaam.trim());
  for (const veld of headerVelden || []) {
    if (!/projectnummer|bedrijf|eindklant/i.test(veld.label)) continue;
    // "5008 │ Vlakkelichtkoepel / Heruvent" → de namen achter het nummer.
    const achter = String(veld.waarde).split(/[│|]/).pop();
    for (const deel of achter.split(/[\/,(]/)) {
      const naam = deel.replace(/\(.*?\)/g, "").trim();
      if (naam.length >= 4 && !/^\d+$/.test(naam)) namen.add(naam);
    }
  }
  for (const naam of namen) termen.push({ soort: "naam", waarde: naam });
  return termen;
}

function alsTekst(bericht) {
  const inhoud = bericht.body?.content || "";
  const plat =
    bericht.body?.contentType === "html"
      ? inhoud
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      : inhoud;
  return plat.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @returns {Promise<Array<{van, aan, datum, onderwerp, tekst, gevondenOp}>>}
 */
async function zoekVoorProject({ projectNaam, headerVelden, config }) {
  if (!config?.aan || !gekoppeld()) return [];

  const dagen = config.dagen || 60;
  const max = config.maxBerichten || 15;
  const grens = new Date(Date.now() - dagen * 86400000);

  const gevonden = new Map();
  for (const term of zoektermen(projectNaam, headerVelden)) {
    if (gevonden.size >= max * 2) break;
    // participants: dekt afzender én ontvangers, zodat je eigen antwoorden
    // in de draad ook meekomen.
    const zoek = term.soort === "adres" ? `participants:${term.waarde}` : `"${term.waarde}"`;
    const pad =
      `/me/messages?$search=${encodeURIComponent(`"${zoek}"`)}` +
      `&$select=${VELDEN}&$top=${Math.min(max * 2, 25)}`;
    let uit;
    try {
      uit = await graph(pad, config);
    } catch (_) {
      continue; // een term die niets oplevert mag de rest niet blokkeren
    }
    for (const bericht of uit.value || []) {
      if (gevonden.has(bericht.id)) continue;
      if (new Date(bericht.receivedDateTime) < grens) continue;
      gevonden.set(bericht.id, { bericht, gevondenOp: term.waarde });
    }
  }

  return [...gevonden.values()]
    .sort((a, b) => new Date(b.bericht.receivedDateTime) - new Date(a.bericht.receivedDateTime))
    .slice(0, max)
    .map(({ bericht, gevondenOp }) => ({
      van: bericht.from?.emailAddress
        ? `${bericht.from.emailAddress.name || ""} <${bericht.from.emailAddress.address}>`.trim()
        : "onbekend",
      aan: (bericht.toRecipients || [])
        .map((r) => r.emailAddress?.name || r.emailAddress?.address)
        .filter(Boolean)
        .join(", "),
      datum: bericht.receivedDateTime,
      onderwerp: bericht.subject || "(geen onderwerp)",
      tekst: alsTekst(bericht).slice(0, 1500),
      gevondenOp,
    }));
}

module.exports = { zoekVoorProject, zoektermen, adressenUit, alsTekst };
