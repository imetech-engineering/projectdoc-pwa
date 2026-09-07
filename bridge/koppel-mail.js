#!/usr/bin/env node
/**
 * Eenmalig je Outlook koppelen aan de bridge.
 *
 *   node koppel-mail.js
 *
 * Toont een code, jij logt in op een ander scherm, en daarna onthoudt de
 * bridge de verbinding zelf. Er komt geen wachtwoord in een bestand: alleen
 * een vernieuwingstoken, dat je altijd kunt intrekken via je Microsoft-account
 * (Beveiliging → Apps met toegang).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { koppel, graph, TOKENBESTAND } = require("./lib/graph");

const CONFIG_PAD = process.env.PROJECTDOC_CONFIG || path.join(__dirname, "config.json");

(async () => {
  if (!fs.existsSync(CONFIG_PAD)) {
    console.error(`Geen config gevonden op ${CONFIG_PAD}.`);
    process.exit(1);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PAD, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    console.error(`config.json is geen geldige JSON: ${e.message}`);
    console.error("");
    console.error("Let op: het 'mail'-blok hoort binnen de buitenste accolades te staan,");
    console.error("met een komma achter de regel ervoor. Makkelijker gaat het met:");
    console.error("  powershell -ExecutionPolicy Bypass -File .\\zet-mail.ps1 -ClientId <id> -TenantId <id>");
    process.exit(1);
  }
  const mail = config.mail || {};
  if (!mail.clientId || !mail.tenantId) {
    console.error("Zet eerst 'mail.clientId' en 'mail.tenantId' in config.json.");
    console.error("Die vind je in Azure onder je app-registratie → Overzicht.");
    process.exit(1);
  }

  try {
    await koppel(mail);
    const ik = await graph("/me?$select=displayName,mail,userPrincipalName", mail);
    console.log(`Gekoppeld als ${ik.displayName} (${ik.mail || ik.userPrincipalName}).`);

    const proef = await graph("/me/messages?$top=1&$select=subject,receivedDateTime", mail);
    const eerste = proef.value?.[0];
    console.log(
      eerste
        ? `Mail lezen werkt. Meest recente bericht: "${eerste.subject}" (${eerste.receivedDateTime.slice(0, 10)}).`
        : "Mail lezen werkt, maar er staat niets in het postvak."
    );
    console.log("");
    console.log(`De koppeling staat in ${TOKENBESTAND} — dat bestand hoort niet in git en staat in .gitignore.`);
    console.log("Zet in config.json 'mail.aan' op true en herstart de bridge.");
  } catch (e) {
    console.error(`Mislukt: ${e.message}`);
    process.exit(1);
  }
})();
