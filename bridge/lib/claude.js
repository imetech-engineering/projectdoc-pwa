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
    path.join(thuis, ".local", "bin", "claude.exe"),
    path.join(thuis, ".local", "bin", "claude.cmd"),
    path.join(process.env.LOCALAPPDATA || thuis, "Programs", "claude", "claude.exe"),
    path.join(thuis, "AppData", "Local", "Microsoft", "WindowsApps", "claude.exe"),
  ];
}

/** Het js-bestand waar een .cmd-shim naar wijst, als dat te vinden is. */
function achterDeShim(cmdPad) {
  const map = path.dirname(cmdPad);
  return (
    [
      path.join(map, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
      path.join(map, "..", "lib", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    ].find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch (_) {
        return false;
      }
    }) || null
  );
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
  if (/\.js$/i.test(pad)) return { uitvoerbaar: process.execPath, voorafArgs: [pad], shell: false, pad };
  if (isWindows && /\.(cmd|bat)$/i.test(pad)) {
    const js = achterDeShim(pad);
    if (js) return { uitvoerbaar: process.execPath, voorafArgs: [js], shell: false, pad: js };
    return { uitvoerbaar: `"${pad}"`, voorafArgs: [], shell: true, pad };
  }
  return { uitvoerbaar: pad, voorafArgs: [], shell: false, pad };
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
  if (schema) {
    const schemaTekst = JSON.stringify(schema);
    // Op de shell-route worden argumenten ongeschonden aan elkaar geplakt, dus
    // knipt de opdrachtprompt het schema af bij de eerste spatie. Het schema
    // hoort daarom spatievrij te zijn; deze controle houdt dat zo.
    if (start.shell && /\s/.test(schemaTekst)) {
      return Promise.reject(
        new Error("Het JSON-schema bevat spaties en overleeft de opdrachtprompt niet.")
      );
    }
    args.push("--json-schema", schemaTekst);
  }

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

/** Zelfde, maar met een JSON-schema: geeft het geparste object terug. */
async function vraagJson(prompt, schema, opties = {}) {
  const antwoord = await vraagClaude(prompt, { ...opties, schema });
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
