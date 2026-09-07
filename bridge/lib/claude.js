/**
 * Praat met Claude Code op deze pc. Draait op het Claude-abonnement waarmee
 * hier is ingelogd — er is geen API-sleutel en er zijn geen losse API-kosten.
 *
 * Bewust alles via stdin en zo min mogelijk via de opdrachtregel: op Windows
 * loopt een commando met een lange tekst erin tegen de 8191-tekens grens aan.
 */
"use strict";

const { spawn } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const isWindows = process.platform === "win32";

/**
 * Waar staat Claude Code?
 *
 * Als de bridge via de taakplanner start, is het PATH vaak anders dan in je
 * eigen terminal en is "claude" daar onvindbaar. Daarom zoeken we hem zelf op:
 * eerst een pad uit config.json, dan het PATH, dan de plekken waar de
 * installers hem neerzetten.
 */
function viaPad(naam) {
  const mappen = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const staarten = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const map of mappen) {
    for (const staart of staarten) {
      const kandidaat = path.join(map, naam + staart);
      try {
        if (fs.statSync(kandidaat).isFile()) return kandidaat;
      } catch (_) {}
    }
  }
  return null;
}

function bekendePlekken() {
  const thuis = process.env.USERPROFILE || os.homedir();
  if (!isWindows) {
    return [
      path.join(thuis, ".local/bin/claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
  }
  const npmMap = path.join(process.env.APPDATA || thuis, "npm");
  return [
    path.join(npmMap, "claude.cmd"),
    path.join(npmMap, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    path.join(thuis, ".local", "bin", "claude.exe"),
    path.join(thuis, ".local", "bin", "claude.cmd"),
    path.join(process.env.LOCALAPPDATA || thuis, "Programs", "claude", "claude.exe"),
    path.join(thuis, "AppData", "Local", "Microsoft", "WindowsApps", "claude.exe"),
  ];
}

/**
 * Waar wijst een .cmd-shim naar?
 *
 * Zo'n shim van npm is een klein tekstbestand dat het echte programma
 * aanroept. Dat kan een js-bestand zijn (dan draait node het) of een los
 * programma. Welke van de twee, en waar het staat, verschilt per versie — dus
 * lezen we het gewoon uit het bestand in plaats van het te raden.
 *
 * @returns {{pad: string, soort: "js"|"exe"}|null}
 */
function achterDeShim(cmdPad) {
  const map = path.dirname(cmdPad);
  const bestaat = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch (_) {
      return false;
    }
  };
  const soortVan = (p) => (/\.js$/i.test(p) ? "js" : "exe");

  let inhoud = "";
  try {
    inhoud = fs.readFileSync(cmdPad, "utf8");
  } catch (_) {}

  // "%~dp0" en "%dp0%" staan voor de map waarin de shim zelf staat.
  for (const treffer of inhoud.matchAll(/%[~]?dp0%?[\\/]*([^"\s]+\.(?:js|exe))/gi)) {
    const kandidaat = path.join(map, treffer[1]);
    if (bestaat(kandidaat)) return { pad: kandidaat, soort: soortVan(kandidaat) };
  }
  for (const treffer of inhoud.matchAll(/"([A-Za-z]:\\[^"]+\.(?:js|exe))"/g)) {
    if (bestaat(treffer[1])) return { pad: treffer[1], soort: soortVan(treffer[1]) };
  }

  // Valt er niets uit te lezen, dan de gebruikelijke indelingen van npm.
  const kandidaat = [
    path.join(map, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    path.join(map, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    path.join(map, "..", "lib", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  ].find(bestaat);
  return kandidaat ? { pad: kandidaat, soort: soortVan(kandidaat) } : null;
}

/**
 * Hoe starten we Claude Code?
 *
 * Liefst rechtstreeks met node, want een .cmd kan alleen via de opdrachtprompt
 * en die sloopt de aanhalingstekens in het JSON-schema dat we meesturen.
 */
function startwijze(uitConfig) {
  const pad = zoekClaude(uitConfig);
  if (!pad) return null;
  if (/\.js$/i.test(pad)) return { uitvoerbaar: process.execPath, voorafArgs: [pad], shell: false, pad, route: "node" };
  if (isWindows && /\.(cmd|bat)$/i.test(pad)) {
    const echt = achterDeShim(pad);
    if (echt && echt.soort === "js") {
      return { uitvoerbaar: process.execPath, voorafArgs: [echt.pad], shell: false, pad: echt.pad, route: "node" };
    }
    if (echt) return { uitvoerbaar: echt.pad, voorafArgs: [], shell: false, pad: echt.pad, route: "direct" };
    // Zonder shell:true, want dan plakt node de argumenten ongeschonden aan
    // elkaar en sneuvelen de aanhalingstekens van het JSON-schema. Zo geeft
    // node ze stuk voor stuk door en doet cmd alleen het startwerk.
    return {
      uitvoerbaar: process.env.ComSpec || "cmd.exe",
      voorafArgs: ["/d", "/s", "/c", pad],
      shell: false,
      pad,
      route: "cmd",
    };
  }
  return { uitvoerbaar: pad, voorafArgs: [], shell: false, pad, route: "direct" };
}

function zoekClaude(uitConfig) {
  const eigen = uitConfig && uitConfig !== "claude" ? uitConfig : null;
  if (eigen) {
    // Een zelf ingevuld pad gaat voor, ook als het een naam is die in PATH staat.
    if (path.isAbsolute(eigen)) return fs.existsSync(eigen) ? eigen : null;
    return viaPad(eigen);
  }
  return viaPad("claude") || bekendePlekken().find((p) => fs.existsSync(p)) || null;
}

/**
 * De omgeving voor het kindproces.
 *
 * CLAUDECODE gaat eruit: als je de bridge start vanuit een Claude Code-venster
 * erft hij die vlag, en dan weigert Claude te starten omdat hij denkt dat het
 * een sessie in een sessie is. De bridge is een losse dienst, geen sessie.
 */
function omgeving() {
  const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "projectdoc-bridge" };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  return env;
}

/** Lege werkmap: Claude heeft hier niets te lezen, alle context komt uit de prompt. */
function werkmap() {
  const map = path.join(os.tmpdir(), "projectdoc-bridge");
  fs.mkdirSync(map, { recursive: true });
  return map;
}

/**
 * @returns {Promise<{tekst: string, kosten: number, duurMs: number}>}
 */
function vraagClaude(prompt, opties = {}) {
  const { model = "opus", schema = null, timeoutMs = 240000, commando = "claude" } = opties;

  const start = startwijze(commando);
  if (!start) {
    return Promise.reject(
      new Error(
        "Claude Code niet gevonden. Zet het volledige pad in config.json bij 'claudeCommando' — " +
          "vind het met: Get-Command claude | Select-Object -ExpandProperty Source"
      )
    );
  }

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    // Niets mag om toestemming vragen (er kijkt niemand mee) en niets mag
    // buiten de prompt om iets aanraken.
    "--permission-prompts",
    "none",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
  // Via de opdrachtprompt overleeft een JSON-schema de reis niet: de
  // aanhalingstekens sneuvelen onderweg. Dan zetten we het schema liever in de
  // prompt; vraagJson vangt dat op.
  if (schema && start.route === "cmd") {
    return Promise.reject(new Error("json-schema kan niet via de opdrachtprompt"));
  }
  if (schema) args.push("--json-schema", JSON.stringify(schema));

  return new Promise((resolve, reject) => {
    const begin = Date.now();
    const kind = spawn(start.uitvoerbaar, [...start.voorafArgs, ...args], {
      cwd: werkmap(),
      shell: start.shell,
      windowsHide: true,
      env: omgeving(),
    });

    let uit = "";
    let fout = "";
    const klok = setTimeout(() => {
      kind.kill();
      reject(new Error(`Claude reageerde niet binnen ${Math.round(timeoutMs / 1000)} seconden`));
    }, timeoutMs);

    kind.stdout.on("data", (d) => (uit += d));
    kind.stderr.on("data", (d) => (fout += d));
    kind.on("error", (e) =>
      reject(new Error(e.code === "ENOENT" ? `Kon Claude Code niet starten via ${start.pad}` : e.message))
    );
    kind.on("close", (code) => {
      clearTimeout(klok);
      if (!uit.trim()) {
        reject(new Error(fout.trim() || `Claude stopte met code ${code} zonder antwoord`));
        return;
      }
      let json;
      try {
        json = JSON.parse(uit);
      } catch (_) {
        reject(new Error(`Onleesbaar antwoord van Claude: ${uit.slice(0, 300)}`));
        return;
      }
      if (json.is_error) {
        reject(new Error(json.result || "Claude gaf een fout terug"));
        return;
      }
      resolve({
        tekst: String(json.result ?? ""),
        kosten: Number(json.total_cost_usd || 0),
        duurMs: Date.now() - begin,
      });
    });

    kind.stdin.on("error", () => {});
    kind.stdin.end(prompt, "utf8");
  });
}

function leesJson(antwoord) {
  const ruw = antwoord.tekst.trim();
  // Structured output geeft kale JSON; val terug op het eerste JSON-blok als
  // er onverhoopt toch tekst omheen staat.
  const kandidaat = ruw.startsWith("{") ? ruw : ruw.slice(ruw.indexOf("{"), ruw.lastIndexOf("}") + 1);
  try {
    return { data: JSON.parse(kandidaat), kosten: antwoord.kosten, duurMs: antwoord.duurMs };
  } catch (_) {
    throw new Error(`Claude gaf geen bruikbare JSON terug: ${ruw.slice(0, 300)}`);
  }
}

/**
 * Zelfde, maar met een JSON-schema: geeft het geparste object terug.
 *
 * Het schema gaat als argument mee op de opdrachtregel, en op Windows kan dat
 * op een ongelukkige installatie alsnog verminkt raken. Gaat het daarop mis,
 * dan zetten we het schema gewoon in de prompt en lezen we het antwoord zelf
 * uit — trager en iets minder streng, maar het werkt.
 */
async function vraagJson(prompt, schema, opties = {}) {
  try {
    return leesJson(await vraagClaude(prompt, { ...opties, schema }));
  } catch (e) {
    if (!/json.?schema|valid json|verminkt|spaties/i.test(e.message)) throw e;
    const metSchemaInPrompt =
      `${prompt}\n\nAntwoord uitsluitend met JSON die aan dit schema voldoet. Geen uitleg, ` +
      `geen tekst eromheen, geen code-blok:\n${JSON.stringify(schema, null, 1)}`;
    return leesJson(await vraagClaude(metSchemaInPrompt, opties));
  }
}

/** Draait Claude één keer kort om te controleren of alles werkt. */
async function zelftest(opties = {}) {
  const { tekst } = await vraagClaude("Antwoord met exact het woord: ok", {
    ...opties,
    model: opties.model || "sonnet",
    timeoutMs: 90000,
  });
  return tekst.trim().toLowerCase().includes("ok");
}

module.exports = { vraagClaude, vraagJson, zelftest, zoekClaude, startwijze };
