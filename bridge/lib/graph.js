/**
 * Inloggen bij Microsoft en de Graph-API bevragen, zonder externe pakketten.
 *
 * We gebruiken de apparaatcode-stroom: de bridge toont een code, jij logt in
 * op een ander scherm. Er staat dus nergens een wachtwoord of een geheim van
 * de app-registratie; alleen een vernieuwingstoken, dat je op elk moment kunt
 * intrekken via je Microsoft-account.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TOKENBESTAND = path.join(__dirname, "..", "mail-token.json");
const SCOPES = "offline_access User.Read Mail.Read";

const basis = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

async function postForm(url, velden) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(velden).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Start de apparaatcode-stroom en wacht tot je bent ingelogd. */
async function koppel({ clientId, tenantId }, opMelding = console.log) {
  const start = await postForm(`${basis(tenantId)}/devicecode`, {
    client_id: clientId,
    scope: SCOPES,
  });
  if (!start.ok) {
    throw new Error(start.data.error_description || `Kon geen code aanvragen (${start.status})`);
  }

  opMelding("");
  opMelding(start.data.message || `Ga naar ${start.data.verification_uri} en voer in: ${start.data.user_code}`);
  opMelding("");

  const eind = Date.now() + (start.data.expires_in || 900) * 1000;
  const wacht = (start.data.interval || 5) * 1000;

  while (Date.now() < eind) {
    await new Promise((r) => setTimeout(r, wacht));
    const uit = await postForm(`${basis(tenantId)}/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: start.data.device_code,
    });
    if (uit.ok) {
      bewaarToken({ refresh_token: uit.data.refresh_token, clientId, tenantId });
      return uit.data;
    }
    const fout = uit.data.error;
    if (fout === "authorization_pending") continue;
    if (fout === "slow_down") {
      await new Promise((r) => setTimeout(r, wacht));
      continue;
    }
    throw new Error(uit.data.error_description || fout || "Inloggen mislukt");
  }
  throw new Error("De code is verlopen; probeer het opnieuw.");
}

function bewaarToken(gegevens) {
  fs.writeFileSync(TOKENBESTAND, JSON.stringify(gegevens, null, 2), { mode: 0o600 });
}

function leesToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKENBESTAND, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return null;
  }
}

const gekoppeld = () => !!leesToken()?.refresh_token;

/** Cache van het toegangstoken; dat is maar een uur geldig. */
let cache = { token: null, tot: 0 };

async function toegangstoken(config) {
  if (cache.token && Date.now() < cache.tot - 60000) return cache.token;

  const bewaard = leesToken();
  if (!bewaard?.refresh_token) {
    throw new Error("Nog geen mailkoppeling. Draai eenmalig: node koppel-mail.js");
  }
  const clientId = config?.clientId || bewaard.clientId;
  const tenantId = config?.tenantId || bewaard.tenantId;

  const uit = await postForm(`${basis(tenantId)}/token`, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: bewaard.refresh_token,
    scope: SCOPES,
  });
  if (!uit.ok) {
    throw new Error(
      `Mailkoppeling werkt niet meer (${uit.data.error || uit.status}). Draai opnieuw: node koppel-mail.js`
    );
  }
  // Microsoft geeft telkens een nieuw vernieuwingstoken terug; het oude vervalt.
  if (uit.data.refresh_token) bewaarToken({ ...bewaard, refresh_token: uit.data.refresh_token });
  cache = { token: uit.data.access_token, tot: Date.now() + (uit.data.expires_in || 3600) * 1000 };
  return cache.token;
}

async function graph(pad, config) {
  const token = await toegangstoken(config);
  const res = await fetch(`https://graph.microsoft.com/v1.0${pad}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => "");
    throw new Error(`Graph gaf ${res.status}: ${tekst.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { koppel, gekoppeld, graph, toegangstoken, TOKENBESTAND };
