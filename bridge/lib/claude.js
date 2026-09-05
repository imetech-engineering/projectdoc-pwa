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
    const kind = spawn(commando, args, {
      cwd: werkmap(),
      shell: isWindows, // claude is op Windows een .cmd
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
      reject(
        new Error(
          e.code === "ENOENT"
            ? "Claude Code niet gevonden. Installeer het of zet 'claudeCommando' in config.json op het volledige pad."
            : e.message
        )
      )
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

module.exports = { vraagClaude, vraagJson, zelftest };
