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
  return [
    path.join(process.env.APPDATA || thuis, "npm", "claude.cmd"),
    path.join(thuis, ".local", "bin", "claude.exe"),
    path.join(thuis, ".local", "bin", "claude.cmd"),
    path.join(process.env.LOCALAPPDATA || thuis, "Programs", "claude", "claude.exe"),
    path.join(thuis, "AppData", "Local", "Microsoft", "WindowsApps", "claude.exe"),
  ];
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

  const pad = zoekClaude(commando);
  if (!pad) {
    return Promise.reject(
      new Error(
        "Claude Code niet gevonden. Zet het volledige pad in config.json bij 'claudeCommando' — " +
          "vind het met: Get-Command claude | Select-Object -ExpandProperty Source"
      )
    );
  }
  // Een .cmd start alleen via de opdrachtprompt; een .exe rechtstreeks, want
  // dan hoeven spaties in het pad niet ontweken te worden.
  const viaOpdrachtprompt = isWindows && /\.(cmd|bat)$/i.test(pad);
  const uitvoerbaar = viaOpdrachtprompt && /\s/.test(pad) ? `"${pad}"` : pad;

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
  if (schema) args.push("--json-schema", JSON.stringify(schema));

  return new Promise((resolve, reject) => {
    const begin = Date.now();
    const kind = spawn(uitvoerbaar, args, {
      cwd: werkmap(),
      shell: viaOpdrachtprompt,
      windowsHide: true,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "projectdoc-bridge" },
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
      reject(new Error(e.code === "ENOENT" ? `Kon Claude Code niet starten via ${pad}` : e.message))
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

module.exports = { vraagClaude, vraagJson, zelftest, zoekClaude };
