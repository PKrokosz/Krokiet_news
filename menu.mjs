import { createInterface } from "readline";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { C, FORMATS, PERSONAS, TONES, LANGS, DEF_FORMAT, DEF_PERSONA, DEF_TONE, DEF_LANG, DEFAULT_MODEL, listModels } from "./lib/shared.mjs";

let rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

const SETTINGS_FILE = "settings.json";

function loadSettings() {
  try { return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")); }
  catch { return { model: DEFAULT_MODEL, format: DEF_FORMAT, persona: DEF_PERSONA, tone: DEF_TONE, lang: DEF_LANG, queries: 0 }; }
}
function saveSettings(s) { writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }

function fmtLabel(s) { return FORMATS[s]?.label || s; }
function perLabel(s) { return PERSONAS[s]?.label || s; }
function toneLabel(s) { return TONES[s]?.label || s; }
function langLabel(s) { return LANGS[s]?.label || s; }

async function run(cmd, ...args) {
  rl.close();
  const full = [cmd, ...args];
  console.log(`\n  → node ${full.join(" ")}\n`);
  const child = spawn("node", full, { cwd: process.cwd(), stdio: "inherit" });
  return new Promise(resolve => {
    child.on("exit", () => {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      resolve();
    });
    child.on("error", e => {
      console.error(`  Błąd: ${e.message}`);
      rl = createInterface({ input: process.stdin, output: process.stdout });
      resolve();
    });
  });
}

function showHeader(title) {
  console.log(`${C.cyn}╔══════════════════════════════════════════╗${C.rst}`);
  console.log(`${C.cyn}║${C.rst}  ${title.padEnd(38)} ${C.cyn}║${C.rst}`);
  console.log(`${C.cyn}╚══════════════════════════════════════════╝${C.rst}`);
}

function showSettingsSummary(s) {
  console.log(`  ${C.dim}Model:${C.rst} ${s.model}`);
  console.log(`  ${C.dim}Format:${C.rst} ${fmtLabel(s.format)} | ${C.dim}Persona:${C.rst} ${perLabel(s.persona)}`);
  console.log(`  ${C.dim}Ton:${C.rst} ${toneLabel(s.tone)} | ${C.dim}Język:${C.rst} ${langLabel(s.lang)}`);
  if (s.queries > 0) console.log(`  ${C.dim}Queries:${C.rst} ${s.queries} (rotacja)`);
}

function buildArgs(s, extra = {}) {
  const a = [];
  if (s.format !== DEF_FORMAT) { a.push("--format", s.format); }
  if (s.persona !== DEF_PERSONA) { a.push("--persona", s.persona); }
  if (s.tone !== DEF_TONE) { a.push("--tone", s.tone); }
  if (s.lang !== DEF_LANG) { a.push("--lang", s.lang); }
  if (s.model !== DEFAULT_MODEL) { a.push("--model", s.model); }
  if (s.queries > 0) { a.push("--queries", String(s.queries)); }
  if (extra.digest) a.push("--digest");
  if (extra.review) a.push("--review");
  if (extra.push) a.push("--push");
  if (extra.verbose) a.push("--verbose");
  if (extra.newsletter) a.push("--newsletter");
  return a;
}

async function showConfigAndRun(mode) {
  const s = loadSettings();
  while (true) {
    console.log();
    showHeader(`SmartBuyers v3 — ${mode === "auto" ? "Auto-watch RSS" : mode === "review" ? "Review RSS" : mode}`);
    showSettingsSummary(s);
    console.log();
    if (mode === "auto") {
      console.log(`  ${C.dim}Digest:${C.rst} ${s._digest ? "tak" : "nie"} | ${C.dim}Newsletter:${C.rst} ${s._newsletter ? "tak" : "nie"} | ${C.dim}Verbose:${C.rst} ${s._verbose ? "tak" : "nie"}`);
      console.log();
    }
    const a = await ask(`  [Enter] = uruchom | [s] = ustawienia | [q] = wstecz: `);
    const c = a.trim().toLowerCase();
    if (c === "q") return;
    if (c === "s") {
      if (mode === "auto") {
        const d = (await ask(`  Digest mode? [t/n, Enter=${s._digest ? "t" : "n"}]: `)).trim().toLowerCase();
        if (d === "t" || d === "tak") s._digest = true;
        else if (d === "n" || d === "nie") s._digest = false;
        const nl = (await ask(`  Newsletter po pushu? [t/n, Enter=${s._newsletter ? "t" : "n"}]: `)).trim().toLowerCase();
        if (nl === "t" || nl === "tak") s._newsletter = true;
        else if (nl === "n" || nl === "nie") s._newsletter = false;
        const v = (await ask(`  Verbose? [t/n, Enter=${s._verbose ? "t" : "n"}]: `)).trim().toLowerCase();
        if (v === "t" || v === "tak") s._verbose = true;
        else if (v === "n" || v === "nie") s._verbose = false;
      }
      await settingsMenu(true);
      Object.assign(s, loadSettings());
      continue;
    }
    break;
  }
  const extra = { push: true, digest: !!s._digest, newsletter: !!s._newsletter, verbose: !!s._verbose, review: mode === "review" };
  await run("rss-watch.mjs", ...buildArgs(s, extra));
}

async function pickModel(s) {
  const models = await listModels();
  const list = models.length ? models : [DEFAULT_MODEL];
  if (models.length === 0) console.log(`  ${C.ylw}→ NVIDIA API nie odpowiada — pokazuję domyślny model${C.rst}`);
  console.log(`  ${C.dim}Dostępne modele (NVIDIA):${C.rst}`);
  list.slice(0, 30).forEach((m, i) => console.log(`    ${i + 1}. ${m}${m === s.model ? ` ${C.grn}← obecny${C.rst}` : ""}`));
  if (models.length > 30) console.log(`    … i ${models.length - 30} więcej`);
  const p = parseInt(await ask(`  Wybierz (1-${Math.min(list.length, 30)}, Enter=bez zmian): `), 10);
  if (p >= 1 && p <= list.length) s.model = list[p - 1];
}

async function settingsMenu(sub) {
  const s = loadSettings();
  while (true) {
    console.log();
    showHeader("Ustawienia");
    console.log(`  1. Model:     ${C.grn}${s.model}${C.rst}`);
    console.log(`  2. Format:    ${C.grn}${fmtLabel(s.format)}${C.rst}`);
    console.log(`  3. Persona:   ${C.grn}${perLabel(s.persona)}${C.rst}`);
    console.log(`  4. Ton:       ${C.grn}${toneLabel(s.tone)}${C.rst}`);
    console.log(`  5. Język:     ${C.grn}${langLabel(s.lang)}${C.rst}`);
    console.log(`  6. Queries:   ${C.grn}${s.queries}${C.rst} (rotacja Google News; 0 = wył.)`);
    console.log(`  7. Przywróć domyślne`);
    console.log(`  8. ${sub ? "Powrót" : "Wstecz"}\n`);
    const p = parseInt(await ask(`  Wybierz (1-8): `), 10);
    if (p === 8) return;
    if (p === 7) {
      Object.assign(s, { model: DEFAULT_MODEL, format: DEF_FORMAT, persona: DEF_PERSONA, tone: DEF_TONE, lang: DEF_LANG, queries: 0 });
      delete s._digest; delete s._newsletter; delete s._verbose;
      saveSettings(s);
      console.log(`  ${C.grn}→ Ustawienia domyślne przywrócone${C.rst}`);
      continue;
    }
    if (p === 1) { await pickModel(s); saveSettings(s); continue; }
    if (p === 2) {
      const keys = Object.keys(FORMATS);
      console.log(`  ${C.dim}Dostępne formaty:${C.rst}`);
      keys.forEach((k, i) => console.log(`    ${i + 1}. ${FORMATS[k].label}${k === s.format ? ` ${C.grn}←${C.rst}` : ""}`));
      const pk = parseInt(await ask(`  Wybierz (1-${keys.length}, Enter=bez zmian): `), 10);
      if (pk >= 1 && pk <= keys.length) s.format = keys[pk - 1];
      saveSettings(s); continue;
    }
    if (p === 3) {
      const keys = Object.keys(PERSONAS);
      console.log(`  ${C.dim}Dostępne persony:${C.rst}`);
      keys.forEach((k, i) => console.log(`    ${i + 1}. ${PERSONAS[k].label}${k === s.persona ? ` ${C.grn}←${C.rst}` : ""}`));
      const pk = parseInt(await ask(`  Wybierz (1-${keys.length}, Enter=bez zmian): `), 10);
      if (pk >= 1 && pk <= keys.length) s.persona = keys[pk - 1];
      saveSettings(s); continue;
    }
    if (p === 4) {
      const keys = Object.keys(TONES);
      console.log(`  ${C.dim}Dostępne tony:${C.rst}`);
      keys.forEach((k, i) => console.log(`    ${i + 1}. ${TONES[k].label}${k === s.tone ? ` ${C.grn}←${C.rst}` : ""}`));
      const pk = parseInt(await ask(`  Wybierz (1-${keys.length}, Enter=bez zmian): `), 10);
      if (pk >= 1 && pk <= keys.length) s.tone = keys[pk - 1];
      saveSettings(s); continue;
    }
    if (p === 5) {
      const keys = Object.keys(LANGS);
      console.log(`  ${C.dim}Dostępne języki:${C.rst}`);
      keys.forEach((k, i) => console.log(`    ${i + 1}. ${LANGS[k].label}${k === s.lang ? ` ${C.grn}←${C.rst}` : ""}`));
      const pk = parseInt(await ask(`  Wybierz (1-${keys.length}, Enter=bez zmian): `), 10);
      if (pk >= 1 && pk <= keys.length) s.lang = keys[pk - 1];
      saveSettings(s); continue;
    }
    if (p === 6) {
      const q = await ask(`  Liczba zapytań do rotacji [0-20, Enter=${s.queries}]: `);
      const n = parseInt(q, 10);
      if (!isNaN(n) && n >= 0 && n <= 20) s.queries = n;
      saveSettings(s); continue;
    }
  }
}

async function main() {
  process.on("SIGINT", () => { console.log(`\n${C.ylw}⏹ Przerwano${C.rst}`); rl.close(); process.exit(0); });
  if (!existsSync("settings.json")) saveSettings(loadSettings());

  while (true) {
    const s = loadSettings();
    console.log();
    console.log(`${C.cyn}╔══════════════════════════════════════════╗${C.rst}`);
    console.log(`${C.cyn}║${C.rst}          SmartBuyers v3                  ${C.cyn}║${C.rst}`);
    console.log(`${C.cyn}║${C.rst}  Model: ${(s.model + "                    ").slice(0, 16)} ${C.cyn}║${C.rst}`);
    console.log(`${C.cyn}║${C.rst}  ${(fmtLabel(s.format) + " | " + perLabel(s.persona) + "                    ").slice(0, 32)} ${C.cyn}║${C.rst}`);
    console.log(`${C.cyn}╚══════════════════════════════════════════╝${C.rst}`);
    console.log();
    console.log(`  ${C.grn}1.${C.rst} Generuj z tematu`);
    console.log(`  ${C.grn}2.${C.rst} Generuj z RSS`);
    console.log(`  ${C.grn}3.${C.rst} Auto-watch RSS`);
    console.log(`  ${C.grn}4.${C.rst} Review RSS`);
    console.log(`  ${C.grn}5.${C.rst} Analiza treści (gap analyzer)`);
    console.log(`  ${C.grn}6.${C.rst} Newsletter tygodniowy`);
    console.log(`  ${C.grn}7.${C.rst} Ustawienia`);
    console.log(`  ${C.grn}8.${C.rst} Wyjście\n`);
    const pick = parseInt(await ask("  Wybierz (1-8): "), 10);
    console.log();

    if (pick === 1) {
      const topic = (await ask("  Temat artykułu [Enter=dropshipping B2B]: ")).trim() || "Czym jest dropshipping B2B";
      const dopush = (await ask("  Push na git po zapisie? [t/n, Enter=t]: ")).trim().toLowerCase();
      await run("generate.mjs", topic, ...buildArgs(s, { push: dopush !== "n" }));
    } else if (pick === 2) {
      const url = (await ask("  URL feedu RSS [Enter=TechCrunch AI]: ")).trim() || "https://techcrunch.com/category/artificial-intelligence/feed/";
      const dopush = (await ask("  Push na git po zapisie? [t/n, Enter=t]: ")).trim().toLowerCase();
      await run("generate.mjs", "--rss", url, ...buildArgs(s, { push: dopush !== "n" }));
    } else if (pick === 3) {
      await showConfigAndRun("auto");
    } else if (pick === 4) {
      await showConfigAndRun("review");
    } else if (pick === 5) {
      await run("analyze.mjs");
    } else if (pick === 6) {
      await run("newsletter.mjs");
    } else if (pick === 7) {
      await settingsMenu(false);
    } else {
      console.log("  Do widzenia!");
      rl.close();
      process.exit(0);
    }
  }
}
main();
