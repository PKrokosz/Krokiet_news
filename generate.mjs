import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import { setTimeout } from "timers/promises";
import Parser from "rss-parser";
import { C, esc, ts, stepReset, step, loadGen, markGen, NVIDIA_BASE, DEFAULT_MODEL, listModels, parseFlag, FORMATS, PERSONAS, TONES, LANGS, buildPrompt, DEF_FORMAT, DEF_PERSONA, DEF_TONE, DEF_LANG, validate, streamResponse, buildHtml, gitPush, googleIndexingPing, generateIndex, generateSitemap, generateFeed, NB_NEWS_ID, NB_SOURCES_ID, setJsonMode, isJsonMode, emitJSON } from "./lib/shared.mjs";
import { postToLinkedIn } from "./social.mjs";

function nbPush(url, title) {
  const nbPy = new URL("./engines/nb_runner.py", import.meta.url).pathname;
  try {
    execSync(`python "${nbPy}" source-add "${NB_SOURCES_ID}" "${url}" --type url --title "${title.replace(/"/g,'\\"')}"`, { encoding:"utf8", timeout:60000 });
    console.log(`  ${C.dim}→ NB Sources: OK${C.rst}`);
  } catch (e) { console.log(`  ${C.dim}→ NB skip: ${e.message.slice(0,60)}${C.rst}`); }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }
function cleanup() { try { rl.close(); } catch {} }

// --- generation ---
async function generate(model, systemPrompt, userContent, minWords = 200, attempt = 0) {
  const useNvidia = !!process.env.NVIDIA_API_KEY;
  const useOpenRouter = !!process.env.OPENROUTER_KEY;
  const url = useNvidia
    ? `${NVIDIA_BASE}/chat/completions`
    : useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : null;
  if (!url) throw new Error("Brak NVIDIA_API_KEY — ustaw zmienną środowiskową");
  const headers = { "Content-Type": "application/json" };
  if (useNvidia) headers.Authorization = `Bearer ${process.env.NVIDIA_API_KEY}`;
  else if (useOpenRouter) headers.Authorization = `Bearer ${process.env.OPENROUTER_KEY}`;

  const b = { model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" } };

  if (attempt > 0) console.log(`\n  ${C.ylw}── RETRY ${attempt + 1}/2 ──${C.rst}`);
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(b) }); }
  catch (e) { throw new Error(`fetch: ${e.cause?.message || e.message}`); }
  if (!res.ok) { const err = await res.text(); throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`); }

  const raw = await streamResponse(res);
  console.log(`  → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${res.status}`);

  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) {
    const rf = `articles/.raw-${Date.now()}.txt`; writeFileSync(rf, raw, "utf8");
    console.log(`  ${C.ylw}→ JSON fail – raw → ${rf}${C.rst}`);
    return { data: null, raw, valid: false, issues: ["JSON parse failed"] };
  }
  console.log(`  → title: "${(data.title||"").slice(0, 60)}" | body: ${(data.body||"").length} znaków`);
  const v = validate(data, raw, minWords);
  console.log(`  → Słowa: ${v.words} | H2: ${v.hasH2?"✅":"❌"} | Czyt: ${v.readability} | Desc: ${(data.desc||"").length} znaków`);
  if (!v.ok && attempt < 1) { console.log(`  ${C.ylw}→ ${v.issues.join(", ")} – retry${C.rst}`); return generate(model, systemPrompt, userContent, minWords, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- main ---
async function main() {
  process.on("SIGINT", () => { console.log(`\n${C.ylw}⏹ Przerwano${C.rst}`); cleanup(); process.exit(0); });
  const start = Date.now();
  const useNvidia = !!process.env.NVIDIA_API_KEY;
  const useOpenRouter = !!process.env.OPENROUTER_KEY;
  const providerName = useNvidia ? "NVIDIA" : useOpenRouter ? "OpenRouter" : "brak klucza (NVIDIA_API_KEY)";
  const jsonMode = process.argv.includes("--json-output");
  if (jsonMode) setJsonMode(true);

  // --- parse flags ---
  const raw = process.argv.slice(2).filter(a => a !== "--json-output");
  const flagPush = raw.includes("--push");
  const flagNonInteractive = raw.includes("--non-interactive");
  const flagVerb = raw.includes("--verbose") || raw.includes("-v");
  let rssUrl = null;
  const ri = raw.indexOf("--rss");
  if (ri >= 0 && ri + 1 < raw.length) rssUrl = raw[ri + 1];

  // content flags
  const optFormat  = parseFlag(raw, "--format",  FORMATS,  DEF_FORMAT);
  const optPersona = parseFlag(raw, "--persona", PERSONAS, DEF_PERSONA);
  const optTone    = parseFlag(raw, "--tone",    TONES,    DEF_TONE);
  const optLang    = parseFlag(raw, "--lang",    LANGS,    DEF_LANG);

  const skip = new Set(["--push", "--non-interactive", "--verbose", "-v", "--rss", "--format", "--persona", "--tone", "--lang"]);
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    if (skip.has(raw[i])) { if (raw[i] === "--rss" || raw[i] === "--format" || raw[i] === "--persona" || raw[i] === "--tone" || raw[i] === "--lang") i++; continue; }
    positional.push(raw[i]);
  }

  const nb = !process.argv.includes("--no-nb");
  stepReset(rssUrl ? (flagPush ? (nb ? 13 : 12) : (nb ? 12 : 11)) : (flagPush ? (nb ? 12 : 11) : (nb ? 11 : 10)));

  const fmtShort = FORMATS[optFormat].label;
  const personaShort = PERSONAS[optPersona].label;
  const toneShort = TONES[optTone].label;
  const langShort = LANGS[optLang].label;

  if (!jsonMode) {
    console.log("╔══════════════════════════════════════════╗");
    console.log(`║     Generator v3${rssUrl ? " RSS" : ""} · ${fmtShort} · ${personaShort} · ${toneShort} · ${langShort}  ║`);
    console.log(`║     Provider: ${providerName}                         ║`);
    console.log("╚══════════════════════════════════════════╝\n");
  }

  let topic, userContent, systemPrompt, rssSourceLink, rssSourceLabel;

  // [1] Topic / RSS
  step(rssUrl ? "Pobieranie RSS" : "Pobieranie tematu", C.cyn, "rss_fetch");

  if (rssUrl) {
    const parser = new Parser({ timeout: 30000, headers: { 'User-Agent': 'KROKIET-NEWS/3.0' } });
    let parsed;
    try {
      parsed = await parser.parseURL(rssUrl);
      if (!jsonMode) console.log(`  → ${parsed.title || rssUrl}: ${parsed.items.length} wpisów`);
    } catch (e) { if (!jsonMode) console.log(`  ${C.red}→ RSS failed: ${e.message}${C.rst}`); cleanup(); process.exit(1); }

    const gen = loadGen();
    const available = parsed.items.filter(it => { const l = it.link || it.guid || it.title; return l && !gen[l]; });
    if (!jsonMode) console.log(`  → Niegenerowane: ${available.length} / ${parsed.items.length}`);
    if (available.length === 0) { if (!jsonMode) console.log(`  ${C.dim}→ Wszystkie już wygenerowane${C.rst}`); cleanup(); process.exit(0); }

    if (flagNonInteractive) {
      const chosen = available[0];
      const cTitle = chosen.title || "Bez tytułu";
      const cSnippet = (chosen.contentSnippet || chosen.content || "").slice(0, 5000);
      const cLink = chosen.link;
      if (!jsonMode) {
        console.log(`\n  → Auto-pick #1: "${cTitle.slice(0, 80)}"`);
        console.log(`  → Dostępnych: ${available.length} / ${parsed.items.length}`);
      }

      topic = cTitle;
      const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: cTitle, rssSnippet: cSnippet });
      userContent = bp.user;
      systemPrompt = bp.system;
      rssSourceLink = cLink;
      rssSourceLabel = cTitle;
    } else {
      if (!jsonMode) {
        console.log("\n  Wybierz newsa:");
        available.forEach((it, i) => {
          const d = it.pubDate || it.isoDate || "";
          const s = (it.contentSnippet || it.content || "").slice(0, 80).replace(/\n/g, " ");
          console.log(`    ${C.grn}${i + 1}.${C.rst} ${(it.title || "?").slice(0, 90)}`);
          if (d) console.log(`       ${C.dim}${d.slice(0, 30)}${C.rst}`);
          if (s) console.log(`       ${C.dim}"${s}..."${C.rst}`);
        });
      }

      const pick = parseInt(await ask(`\n  Wybierz (1-${available.length}, Enter=1): `), 10);
      const chosen = available[pick - 1] || available[0];
      const cTitle = chosen.title || "Bez tytułu";
      const cSnippet = (chosen.contentSnippet || chosen.content || "").slice(0, 5000);
      const cLink = chosen.link;
      if (!jsonMode) {
        console.log(`\n  → "${cTitle.slice(0, 80)}"`);
        console.log(`  → Treść: ${cSnippet.length} znaków | Link: ${cLink || "brak"}`);
      }

      topic = cTitle;
      const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: cTitle, rssSnippet: cSnippet });
      userContent = bp.user;
      systemPrompt = bp.system;
      rssSourceLink = cLink;
      rssSourceLabel = cTitle;
    }
  } else {
    topic = (positional[0] || "").trim();
    if (!topic) topic = (await ask("  Temat artykułu: ")).trim();
    if (!topic) { topic = "Czym jest dropshipping B2B"; if (!jsonMode) console.log(`  → Domyślny: "${topic}"`); }
    else if (!jsonMode) console.log(`  → "${topic}" (${topic.length} znaków)`);
    const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, topic });
    userContent = bp.user;
    systemPrompt = bp.system;
  }

  // [2] Model
  step("Wybór modelu AI", C.cyn, "model_select");
  let model = (positional[1] || "").trim();
  if (useNvidia) {
    const models = await listModels();
    if (!model) {
      if (flagNonInteractive) {
        model = DEFAULT_MODEL;
        if (!jsonMode) console.log(`  → domyślny: ${model}`);
      } else {
        const list = models.length ? models : [DEFAULT_MODEL];
        if (!jsonMode) {
          console.log("  Dostępne modele (NVIDIA):");
          list.slice(0, 30).forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
          if (models.length > 30) console.log(`    … i ${models.length - 30} więcej`);
        }
        const p = parseInt(await ask(`  Wybierz (1-${Math.min(list.length, 30)}, Enter=${DEFAULT_MODEL}): `), 10);
        model = list[p - 1] || DEFAULT_MODEL;
      }
    }
  } else if (useOpenRouter) {
    if (!model) model = "qwen/qwen-2.5-7b-instruct";
  } else {
    if (!jsonMode) console.log(`  ${C.red}→ Brak NVIDIA_API_KEY — ustaw zmienną środowiskową${C.rst}`);
    cleanup(); process.exit(1);
  }
  if (!jsonMode) console.log(`  → ${model}`);
  if (jsonMode) emitJSON("meta", { format: optFormat, persona: optPersona, tone: optTone, lang: optLang, model, provider: useNvidia ? "nvidia" : useOpenRouter ? "openrouter" : "none" });

  // [3] Dir
  step("Katalog wyjściowy", C.cyn, "dir_check");
  if (!existsSync("articles")) { mkdirSync("articles"); if (!jsonMode) console.log("  → Utworzono articles/"); }
  else if (!jsonMode) console.log("  → articles/ istnieje");

  // [4] Prompt
  step("Prompt", C.cyn, "prompt_build");
  if (!jsonMode) {
    console.log(`  → System: ${systemPrompt.length} znaków`);
    console.log(`  → User:   ${userContent.length} znaków`);
    if (flagVerb) { console.log(`\n  ${C.dim}──${systemPrompt.slice(0,150)}...──${C.rst}`); console.log(`\n  ${C.dim}──${userContent.slice(0,150)}...──${C.rst}`); }
  }

  // [5] Warmup (connectivity check — NVIDIA nie ładuje modelu do RAM)
  if (useNvidia) {
    step("Sprawdzanie połączenia z NVIDIA API", C.ylw, "warmup");
    const tw = Date.now();
    try {
      const wup = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "OK" }], max_tokens: 1 }),
      });
      if (!wup.ok) { if (!jsonMode) console.log(`  ${C.red}→ ${wup.status}${C.rst}`); cleanup(); process.exit(1); }
      const wElapsed = ((Date.now() - tw) / 1000).toFixed(1);
      if (jsonMode) emitJSON("warmup_done", { elapsed: parseFloat(wElapsed), model });
      else console.log(`  ${C.grn}→ Połączono z NVIDIA API | ${wElapsed}s | ${model}${C.rst}`);
    } catch (e) { if (!jsonMode) console.log(`  ${C.red}→ ${e.cause?.message || e.message}${C.rst}`); cleanup(); process.exit(1); }
  }

  // [6] Generate
  step("Generowanie artykułu (streaming tokenów)", C.ylw, "generating");
  const genStart = Date.now();
  let completed = false;
  const statusLoop = setInterval(() => {
    if (!completed) {
      const elapsed = Math.floor((Date.now() - genStart) / 1000);
      if (!jsonMode) console.log(`  ${C.dim}[⌛ ${elapsed}s] AI pisze artykuł...${C.rst}`);
    }
  }, 10000);
  let result;
  try { result = await generate(model, systemPrompt, userContent, LANGS[optLang].minWords); }
  catch (e) { completed = true; clearInterval(statusLoop); if (!jsonMode) console.log(`  ${C.red}→ ${e.message}${C.rst}`); if (jsonMode) emitJSON("error", { msg: e.message }); cleanup(); process.exit(1); }
  completed = true; clearInterval(statusLoop);

  if (!result.data) { if (!jsonMode) console.log(`  ${C.red}→ Nie udało się${C.rst}`); if (jsonMode) emitJSON("error", { msg: "Nie udało się wygenerować" }); cleanup(); process.exit(1); }
  if (result.issues?.length && !jsonMode) console.log(`  ${C.ylw}→ Uwagi: ${result.issues.join(", ")}${C.rst}`);
  if (!jsonMode) {
    console.log(`  → title: "${(result.data.title||"").slice(0, 60)}" | body: ${(result.data.body||"").length} znaków`);
    const v = validate(result.data, result.raw, LANGS[optLang].minWords);
    console.log(`  → Słowa: ${v.words} | H2: ${v.hasH2?"✅":"❌"} | Czyt: ${v.readability} | Desc: ${(result.data.desc||"").length} znaków`);
  }

  // [7] Build HTML
  step("Generowanie dokumentu HTML", C.cyn, "build_html");
  const extra = rssSourceLink ? { sourceLink: rssSourceLink, sourceLabel: rssSourceLabel, format: optFormat } : { format: optFormat };
  const { html, fname, body, slug, artTitle, pageUrl } = buildHtml(result.data, result.raw, topic, model, extra);
  if (!jsonMode) {
    console.log(`  → ${artTitle.slice(0, 60)} | ${slug}`);
    console.log(`  → Body: ${body.length} zn | HTML: ${html.length} zn (~${Math.ceil(html.length/1024)} KB)`);
  }

  // [8] Save
  step("Zapis pliku", C.cyn, "save_file");
  writeFileSync(fname, html, "utf8");
  if (!jsonMode) console.log(`  → ${C.grn}${fname}${C.rst} (${(html.length/1024).toFixed(1)} KB)`);

  // [9] generated.json
  if (rssSourceLink) {
    step("generated.json", C.cyn, "mark_gen");
    markGen(rssSourceLink, slug, result.data?.title || result.data?.topic);
    if (!jsonMode) console.log(`  → ${rssSourceLink.slice(0, 60)} → ${slug}`);
  }

  // regenerate index + sitemap
  step("Index + Sitemap", C.ylw, "reindex");
  const idxCount = generateIndex();
  generateSitemap();
  generateFeed();
  if (!jsonMode) console.log(`  → index.html (${idxCount} artykułów) | feed.xml | sitemap.xml`);

  // [10] NB sync
  if (nb) {
    step("NotebookLM", C.ylw, "nb_sync");
    nbPush(pageUrl, artTitle);
  }

  // [11] Push (optional)
  if (flagPush) {
    step("Git push", C.ylw, "publish");
    const files = rssSourceLink ? "articles/ generated.json" : "articles/";
    gitPush(files, `Add: ${artTitle.slice(0, 60)}`);
    googleIndexingPing(pageUrl);
    postToLinkedIn(artTitle, body.slice(0, 300), pageUrl);
  }

  // Final validation for JSON mode
  const finalV = validate(result.data, result.raw, LANGS[optLang].minWords);

  // Done
  step("Podsumowanie", C.grn, "done");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (jsonMode) {
    // Emit structured done event with full metadata
    const wordCount = (body || "").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    const readMin = Math.max(1, Math.ceil(wordCount / 200));
    emitJSON("done", {
      ok: true,
      title: artTitle,
      slug,
      words: wordCount,
      h2count: (body || "").match(/<h2[^>]*>/gi)?.length || 0,
      readability: finalV.readability,
      time: parseFloat(elapsed),
      file: fname,
      url: pageUrl,
      model,
      sizeKB: (html.length / 1024).toFixed(1),
    });
  } else {
    console.log(`  → ${elapsed}s | Model: ${model} | Body: ${body.length} zn`);
    console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}\n`);
  }
  cleanup();
}
main();
