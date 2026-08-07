import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import Parser from "rss-parser";
import { C, ts, stepReset, step, log, loadGen, isGen, markGen, DEFAULT_MODEL, chatUrl, chatHeaders, providerStatus, parseFlag, FORMATS, PERSONAS, TONES, LANGS, buildPrompt, DEF_FORMAT, DEF_PERSONA, DEF_TONE, DEF_LANG, validate, streamResponse, buildHtml, gitPush, googleIndexingPing, generateIndex, generateSitemap, generateFeed, pushArticleToFirebase, NB_SOURCES_ID, NB_NEWS_ID, setJsonMode, isJsonMode, emitJSON } from "./lib/shared.mjs";
import { postToLinkedIn } from "./social.mjs";
import { generateNewsletter } from "./newsletter.mjs";

function nbPushSource(url, title) {
  try {
    const out = execSync(`python "${fileURLToPath(new URL('./engines/nb_runner.py', import.meta.url))}" source-add "${NB_SOURCES_ID}" "${url}" --type url --title "${title.replace(/"/g,'\\"')}"`, { encoding:"utf8", timeout:60000 });
    console.log(`  ${C.dim}→ NB source: ${JSON.parse(out).id || 'OK'}${C.rst}`);
  } catch (e) { console.log(`  ${C.dim}→ NB skip: ${e.message.slice(0,60)}${C.rst}`); }
}

function nbPushArticle(url, title) {
  try {
    execSync(`python "${fileURLToPath(new URL('./engines/nb_runner.py', import.meta.url))}" source-add "${NB_NEWS_ID}" "${url}" --type url --title "${title.replace(/"/g,'\\"')}"`, { encoding:"utf8", timeout:60000 });
    console.log(`  ${C.dim}→ NB news: OK${C.rst}`);
  } catch (e) { console.log(`  ${C.dim}→ NB news skip: ${e.message.slice(0,60)}${C.rst}`); }
}

const FEEDS_FILE = "feeds.json";
const mi = process.argv.indexOf("--model"); const MODEL = (mi >= 0 && mi + 1 < process.argv.length) ? process.argv[mi + 1] : DEFAULT_MODEL;
const MAX_ITEMS_PER_FEED = 5;
const verb = process.argv.includes("--verbose") || process.argv.includes("-v");
const flagReview = process.argv.includes("--review");
const flagNonInteractive = process.argv.includes("--non-interactive");
const flagPush = process.argv.includes("--push");
const flagDigest = process.argv.includes("--digest");
const queryCount = (() => { const i = process.argv.indexOf("--queries"); return (i >= 0 && i + 1 < process.argv.length) ? parseInt(process.argv[i + 1], 10) || 0 : 0; })();
const flagNewsletter = process.argv.includes("--newsletter");

const optFormat  = parseFlag(process.argv, "--format", FORMATS, DEF_FORMAT);
const optPersona = parseFlag(process.argv, "--persona", PERSONAS, DEF_PERSONA);
const optTone    = parseFlag(process.argv, "--tone", TONES, DEF_TONE);
const optLang    = parseFlag(process.argv, "--lang", LANGS, DEF_LANG);

// --- generate single ---
async function generate(itemTitle, snippet, attempt = 0) {
  const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: itemTitle, rssSnippet: snippet });
  const body = { model: MODEL, messages: [{ role: "system", content: bp.system }, { role: "user", content: bp.user }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" } };
  if (attempt > 0) console.log(`    ${C.ylw}RETRY ${attempt + 1}/2${C.rst}`);
  const t0 = Date.now();
  const res = await fetch(chatUrl(), { method: "POST", headers: chatHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.text(); throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`); }
  const raw = await streamResponse(res, "    ");
  console.log(`    → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${raw.length} znaków`);
  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) { console.log(`    ${C.ylw}→ JSON fail${C.rst}`); return { data: null, raw }; }
  console.log(`    → title: "${(data.title || "").slice(0, 50)}" | body: ${(data.body || "").length} zn`);
  const v = validate(data, raw, LANGS[optLang].minWords);
  console.log(`    → Słowa: ${v.words} | H2: ${v.hasH2 ? "✅" : "❌"} | Czyt: ${v.readability}`);
  if (!v.ok && attempt < 1) { console.log(`    ${C.ylw}→ ${v.issues.join(", ")} — retry${C.rst}`); return generate(itemTitle, snippet, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- generate digest ---
async function generateDigest(items) {
  const digLabel = `${new Date().toLocaleDateString("pl-PL")}, ${new Date().toLocaleTimeString("pl-PL", {hour:"2-digit",minute:"2-digit"})}`;
  const bp = buildPrompt({ format: "digest", persona: optPersona, tone: optTone, lang: optLang, rssTitle: digLabel, rssSnippet: items.map((it, i) => `${i + 1}. ${it.title}\n${it.snippet.slice(0, 500)}`).join("\n---\n") });
  const body = { model: MODEL, messages: [{ role: "system", content: bp.system }, { role: "user", content: bp.user }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" } };
  console.log(`    → Digest: ${items.length} wpisów, ${bp.user.length} zn prompta`);

  const t0 = Date.now();
  const res = await fetch(chatUrl(), { method: "POST", headers: chatHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await streamResponse(res, "    ");
  console.log(`    → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${raw.length} znaków`);

  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) { console.log(`    ${C.ylw}→ JSON fail${C.rst}`); return null; }
  console.log(`    → "${(data.title || "").slice(0, 50)}" | ${(data.body || "").length} zn`);
  return { data, raw };
}

// --- save article ---
function saveArticle(gen, title, link) {
  const extra = link ? { sourceLink: link, sourceLabel: title, format: optFormat } : { format: optFormat };
  const { html, fname, body, slug, artTitle, pageUrl } = buildHtml(gen.data, gen.raw, title, MODEL, extra);
  if (!isJsonMode()) console.log(`  → ${slug} | ${body.length} zn`);
  if (!existsSync("articles")) mkdirSync("articles");
  writeFileSync(fname, html, "utf8");
  if (link) markGen(link, slug, title);
  pushArticleToFirebase(slug, artTitle, body, pageUrl, link);
  if (!isJsonMode()) {
    console.log(`  ${C.grn}→ ${fname}${C.rst}`);
    console.log(`  ${C.cyn}→ ${pageUrl}${C.rst}`);
  }
  return { slug, fname, pageUrl };
}

// --- competitor logging ---
function logCompetitor(feed, item, itemTitle, itemLink) {
  try {
    const c = existsSync("competitors.json") ? JSON.parse(readFileSync("competitors.json", "utf8")) : [];
    c.push({ feedName: feed.name, title: itemTitle, link: itemLink, date: item.pubDate || item.isoDate || new Date().toISOString(), loggedAt: new Date().toISOString() });
    writeFileSync("competitors.json", JSON.stringify(c, null, 2));
  } catch {}
}

// --- keyword filter ---
function matchFilter(feed, title, snippet) {
  if (!feed.filter || !feed.filter.length) return true;
  const txt = (title + " " + (snippet || "")).toLowerCase();
  return feed.filter.some(kw => txt.includes(kw.toLowerCase()));
}

// --- warmup (connectivity check) ---
async function warmup() {
  try {
    const res = await fetch(chatUrl(), {
      method: "POST", headers: chatHeaders(),
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "OK" }], max_tokens: 1 }),
    });
    return res.ok;
  } catch { return false; }
}

// --- main ---
async function main() {
  const start = Date.now();
  const jsonMode = process.argv.includes("--json-output");
  if (jsonMode) setJsonMode(true);

  if (!jsonMode) {
    console.log("╔══════════════════════════════════════════╗");
    console.log(`║     RSS → AI → Blog v3${flagDigest ? " DIGEST" : ""}                  ║`);
    console.log("╚══════════════════════════════════════════╝");
    console.log(`  Tryb: ${verb ? "verbose" : "normalny"}${flagReview ? " + review" : " (auto)"}${flagDigest ? " + digest" : ""}`);
    console.log(`  Model: ${MODEL} | Format: ${FORMATS[optFormat].label} | ${LANGS[optLang].label}`);
    console.log(`  Provider: ${providerStatus()}\n`);
  }
  if (jsonMode) emitJSON("meta", { format: optFormat, persona: optPersona, tone: optTone, lang: optLang, model: MODEL, provider: "nvidia", mode: flagDigest ? "digest" : "watch", feeds: null });

  stepReset(99); step("Wczytywanie feedów", C.cyn, "rss_fetch");
  if (!existsSync(FEEDS_FILE)) { log("ERR", `Brak ${FEEDS_FILE}`, C.red); process.exit(1); }
  const feeds = JSON.parse(readFileSync(FEEDS_FILE, "utf8"));

  // dynamiczne feedy z rotacji zapytań Google News
  if (queryCount > 0 && existsSync("queries.json")) {
    const qdb = JSON.parse(readFileSync("queries.json", "utf8"));
    const pool = [...(qdb.pool || [])];
    const selected = [];
    for (let i = 0; i < queryCount && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      selected.push(pool.splice(idx, 1)[0]);
    }
    const langSuffix = optLang === "pl" ? "&hl=pl&gl=PL&ceid=PL:pl" : "&hl=en&gl=US&ceid=US:en";
    for (const q of selected) {
      const lastGuid = qdb.lastGuids?.[q] || null;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}${langSuffix}`;
      feeds.push({ name: `Google News: ${q}`, url, filter: q.toLowerCase().split(/\s+/), lastGuid, _query: q });
    }
    if (!jsonMode) console.log(`  ${C.dim}→ +${selected.length} dynamicznych feed(ów) z zapytań${C.rst}`);
  }

  log("INFO", `${feeds.length} feed(ów)`);
  if (!jsonMode) {
    feeds.forEach((f, i) => {
      const kw = f.filter ? ` [filtr: ${f.filter.some(f=>typeof f!=='string') ? '(dynamic)' : f.filter.slice(0,3).join(",")}]` : "";
      console.log(`  ${i + 1}. ${f.name || f.url}${kw} | lastGuid: ${f.lastGuid ? f.lastGuid.slice(0, 30) + "..." : "BRAK"}`);
    });
  }
  if (jsonMode) emitJSON("info", { tag: "feeds", msg: `${feeds.length} feedów` });

  const parser = new Parser({ timeout: 30000, headers: { 'User-Agent': 'KROKIET-NEWS/3.0' } });
  let totalGenerated = 0;
  let lastPageUrl;
  const digestItems = [];

  for (const [fi, feed] of feeds.entries()) {
    step(`[Feed ${fi + 1}/${feeds.length}] ${feed.name || feed.url}`, C.ylw, "feed_process");

    let parsed;
    try { parsed = await parser.parseURL(feed.url); } catch (e) { log("ERR", `${e.message}`, C.red); continue; }
    if (!jsonMode) console.log(`  → ${parsed.items.length} wpisów`);
    if (!parsed.items.length) continue;

    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) { log("WARN", "Brak GUID"); continue; }

    // Reddit trzyma przypięte posty moderatorów na pozycji 0 — zawsze je pomijaj
    const isReddit = /reddit\.com/.test(feed.url);
    const startIdx = isReddit ? 1 : 0;

    if (!feed.lastGuid) {
      feed.lastGuid = (parsed.items[startIdx] || newest).guid || newestGuid;
      if (!jsonMode) console.log(`  ${C.dim}→ Pierwsze uruchomienie – GUID zapamiętany${C.rst}`);
      nbPushSource(feed.url, feed.name || "RSS Feed");
      continue;
    }

    // marker może wskazywać na przypięty post (reddit) → nie ufaj pozycji 0
    let markerIdx = parsed.items.findIndex(i => (i.guid || i.link || i.title) === feed.lastGuid);
    if (markerIdx === 0 && isReddit) markerIdx = -1;
    let newCount = 0;
    let feedGenerated = 0;
    let resumeGuid = null;
    // limit dotyczy tylko realnego generowania (nie track/digest)
    const capped = !flagDigest && feed.mode !== "track";

    for (let ii = startIdx; ii < parsed.items.length; ii++) {
      const item = parsed.items[ii];
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (markerIdx !== -1 && guid === feed.lastGuid) break;
      if (capped && feedGenerated >= MAX_ITEMS_PER_FEED) { resumeGuid = guid; break; }

      const itemLink = item.link || item.guid;
      if (itemLink && isGen(itemLink)) continue;

      const itemTitle = item.title || "Bez tytułu";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);

      // keyword filter
      if (!matchFilter(feed, itemTitle, snippet)) {
        if (verb) console.log(`  ${C.dim}→ Filtr: pomijam "${itemTitle.slice(0, 60)}"${C.rst}`);
        continue;
      }

      newCount++; feedGenerated++;

      if (feed.mode === "track") {
        logCompetitor(feed, item, itemTitle, itemLink);
        console.log(`  ${C.dim}→ [track] "${itemTitle.slice(0, 60)}"${C.rst}`);
        continue;
      }

      if (flagDigest) {
        digestItems.push({ title: itemTitle, snippet, link: itemLink });
        console.log(`  ${C.dim}#${ii + 1}: ${itemTitle.slice(0, 70)} [digest]${C.rst}`);
        continue;
      }

      totalGenerated++;
      if (!jsonMode) {
        console.log(`\n  ── NOWY #${ii + 1}: ${itemTitle.slice(0, 80)} ──`);
        console.log(`  Treść: ${snippet.length} znaków | Link: ${itemLink || "brak"}`);
      }

      if (flagReview) {
        if (flagNonInteractive) {
          if (!jsonMode) console.log(`  ${C.dim}[auto-generuj]${C.rst}`);
        } else {
          const ans = await new Promise(r => {
            const rl2 = createInterface({ input: process.stdin, output: process.stdout });
            rl2.question(`  ${C.ylw}[g]eneruj / [p]omiń / [q]wyjdź?${C.rst} `, a => { rl2.close(); r(a.trim().toLowerCase()); });
          });
          if (ans === "q") break;
          if (ans === "p" || ans === "n" || ans === "") { totalGenerated--; feedGenerated--; continue; }
        }
      }

      if (feedGenerated === 1 && !(await warmup())) { if (!jsonMode) console.log(`  ${C.red}NVIDIA API offline${C.rst}`); break; }

      if (!jsonMode) console.log(`  ${C.dim}── generowanie ──${C.rst}`);
      let gen;
      try { gen = await generate(itemTitle, snippet); }
      catch (e) { log("ERR", `${e.message}`, C.red); continue; }
      if (!gen.data) { if (!jsonMode) console.log(`  ${C.red}→ Nieudane${C.rst}`); continue; }
      if (gen.issues?.length && !jsonMode) console.log(`  ${C.ylw}→ ${gen.issues.join(", ")}${C.rst}`);

      const sa = saveArticle(gen, itemTitle, itemLink);
      if (sa) {
        lastPageUrl = sa.pageUrl;
        nbPushSource(itemLink, itemTitle);
        nbPushArticle(itemLink, itemTitle);
      }
    }

    if (newCount > 0 && !jsonMode) console.log(`  → Nowych: ${newCount}${feed.filter ? ` (filtr: ${feed.filter.join(", ")})` : ""}`);
    // resumeGuid = zatrzymaliśmy się na limicie MAX na przebieg → kontynuuj stąd następnym razem;
    // marker nieznaleziony i doszliśmy do końca → najnowszy wpis; inaczej zostaw marker bez zmian
    feed.lastGuid = resumeGuid || (markerIdx === -1 ? (parsed.items[startIdx]?.guid || feed.lastGuid) : feed.lastGuid);
  }

  // --- digest mode: generate one roundup ---
  if (flagDigest && digestItems.length > 0) {
    if (digestItems.length <= 1) {
      log("WARN", "Za mało wpisów do digestu — pomijam", C.ylw);
    } else {
      step("Generowanie digestu", C.ylw, "generating");
      if (!jsonMode) console.log(`  → ${digestItems.length} wpisów zebranych`);
      if (!(await warmup())) { if (!jsonMode) console.log(`  ${C.red}NVIDIA API offline${C.rst}`); }
      else {
        const dig = await generateDigest(digestItems);
        if (dig && dig.data) {
          totalGenerated++;
            const sources = digestItems.map(it => it.link).filter(Boolean).join(" | ");
          const digestLabel = `${new Date().toLocaleDateString("pl-PL")}, ${new Date().toLocaleTimeString("pl-PL", {hour:"2-digit",minute:"2-digit"})}`;
          const sa = saveArticle(dig, digestLabel, sources);
          if (sa) nbPushSource(sa.pageUrl, digestLabel);
          if (sa) lastPageUrl = sa.pageUrl;
          for (const it of digestItems) if (it.link) markGen(it.link, "digest", it.title);
        }
      }
    }
  }

  // zapisz lastGuids dynamicznych zapytań
  if (queryCount > 0 && existsSync("queries.json")) {
    const qdb = JSON.parse(readFileSync("queries.json", "utf8"));
    if (!qdb.lastGuids) qdb.lastGuids = {};
    for (const f of feeds) {
      if (f._query && f.lastGuid) qdb.lastGuids[f._query] = f.lastGuid;
    }
    writeFileSync("queries.json", JSON.stringify(qdb, null, 2));
  }

  // usuń pola _query przed zapisem do feeds.json
  for (const f of feeds) delete f._query;
  writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
  generateIndex(); generateSitemap(); generateFeed();

  if (totalGenerated > 0 && flagPush) {
    step("Git push", C.ylw, "publish");
    if (gitPush("index.html articles/ feeds.json generated.json", `Auto: ${totalGenerated} artykuł(i) z RSS`)) {
      if (lastPageUrl) { googleIndexingPing(lastPageUrl); postToLinkedIn("KROKIET NEWS — Nowy artykuł", "", lastPageUrl); }
    }
    if (!jsonMode) console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/${C.rst}\n`);
  } else if (totalGenerated > 0) {
    step("Brak nowych wpisów");
  }

  if (flagNewsletter) await generateNewsletter();

  const totalTime = ((Date.now() - start) / 1000).toFixed(1);
  if (jsonMode) {
    emitJSON("done", { ok: true, totalGenerated, feeds: feeds.length, time: parseFloat(totalTime) });
  } else {
    console.log(`\n${C.grn}[${ts()}] [DONE] ${totalTime}s | ${feeds.length} feedów | ${totalGenerated} artykułów${C.rst}`);
  }
}
main();
