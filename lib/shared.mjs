import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";

// --- colors ---
export const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};

// --- escapers ---
export function esc(s) { return `${s}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
export function safeHref(url) {
  if (!url) return "";
  const u = url.trim().toLowerCase();
  return (u.startsWith("http://") || u.startsWith("https://")) ? url : "";
}
export function ts() { return new Date().toLocaleTimeString("pl-PL"); }

// --- JSON output mode (for server/UI streaming) ---
let _jsonMode = false;
export function setJsonMode(v) { _jsonMode = v; }
export function isJsonMode() { return _jsonMode; }
export function emitJSON(type, data = {}) {
  process.stdout.write(JSON.stringify({ type, ...data }) + "\n");
}

// --- step counter ---
let stepNo = 0, TOTAL = 9;
export function stepReset(n) { stepNo = 0; TOTAL = n; }
export function step(label, color = C.cyn, phaseId) {
  stepNo++;
  if (_jsonMode) {
    emitJSON("phase", { phase: phaseId || label.toLowerCase().replace(/\s+/g, "_"), label });
  } else {
    console.log(`${color}[${ts()}] [${stepNo}/${TOTAL}] ${label}${C.rst}`);
  }
}
export function log(tag, msg, color = C.cyn) {
  if (_jsonMode) {
    emitJSON("info", { tag, msg });
  } else {
    console.log(`${color}[${ts()}] [${tag}]${C.rst} ${msg}`);
  }
}

// --- flag parser ---
export function parseFlag(args, flag, dict, def) {
  const i = args.indexOf(flag);
  return (i >= 0 && i + 1 < args.length && dict[args[i + 1]]) ? args[i + 1] : def;
}

// --- generated.json ---
const GJ = "generated.json";
export function loadGen() { try { return JSON.parse(readFileSync(GJ, "utf8")); } catch { return {}; } }
export function saveGen(g) { writeFileSync(GJ, JSON.stringify(g, null, 2)); }
export function markGen(url, slug, title) { const g = loadGen(); g[url] = { slug, title: title || slug, date: new Date().toISOString() }; saveGen(g); }
export function isGen(url) { const g = loadGen(); return !!g[url]; }

// --- NVIDIA API provider ---
export const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1";
export function nvidiaKey() { return process.env.NVIDIA_API_KEY || ""; }
export function chatUrl() { return `${NVIDIA_BASE}/chat/completions`; }
export function chatHeaders() {
  const h = { "Content-Type": "application/json" };
  if (nvidiaKey()) h.Authorization = `Bearer ${nvidiaKey()}`;
  return h;
}
export async function listModels() {
  if (!nvidiaKey()) return [];
  try {
    const res = await fetch(`${NVIDIA_BASE}/models`, { headers: { Authorization: `Bearer ${nvidiaKey()}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.data || []).map(m => m.id).sort();
  } catch { return []; }
}
export function providerStatus() {
  return nvidiaKey() ? `NVIDIA build (${DEFAULT_MODEL})` : "NVIDIA API (brak NVIDIA_API_KEY)";
}

// --- prompts ---
// formats
export const FORMATS = {
  article: { label: "Standardowy artykuł", system: "", userHint: "", structure: "body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>." },
  list:    { label: "Top lista",          system: "Format: numerowana lista Top X. Każdy punkt z nagłówkiem <h3> i opisem.", userHint: "Użyj formatu listy Top X z <ol><li><h3>...</h3><p>...</p></li></ol>.", structure: "<ol><li><h3>punkt</h3><p>opis</p></li></ol>" },
  howto:   { label: "Poradnik krok po kroku", system: "Format: poradnik how-to. Struktura: każdy krok jako <h2>, z przykładem.", userHint: "Użyj formatu poradnika: <h2>Krok 1: ...</h2><p>...</p> dla każdego kroku.", structure: "<h2>Krok 1</h2><p>...</p><h2>Krok 2</h2><p>...</p>" },
  explainer:{ label: "Czym jest X",       system: "Format: artykuł wyjaśniający. Struktura: definicja → jak działa → korzyści → przykłady.", userHint: "Struktura: <h2>Czym jest...</h2><h2>Jak działa</h2><h2>Korzyści</h2><h2>Przykłady</h2>.", structure: "<h2>Czym jest</h2><h2>Jak działa</h2><h2>Korzyści</h2>" },
  vs:      { label: "Porównanie X vs Y",  system: "Format: porównanie. Struktura: przegląd X, przegląd Y, tabela różnic, rekomendacja.", userHint: "Struktura: <h2>Przegląd X</h2><h2>Przegląd Y</h2><h2>Porównanie</h2><table>...</table><h2>Który wybrać?</h2>.", structure: "<h2>X</h2><h2>Y</h2><h2>Porównanie</h2><table>...</table>" },
  myth:    { label: "Mit czy fakt",       system: "Format: 5 mitów vs faktów. Każdy: <blockquote>Mit</blockquote> + <p><strong>Fakt</strong></p>.", userHint: "Użyj formatu mit-fakt: <blockquote>Mit: ...</blockquote><p><strong>Fakt:</strong> ...</p> x5.", structure: "<blockquote>Mit</blockquote><p><strong>Fakt</strong></p>" },
  faq:     { label: "FAQ",               system: "Format: FAQ. Struktura: pytanie jako <h3>, odpowiedź jako <p>. Minimum 5 par.", userHint: "Struktura: <h3>Pytanie?</h3><p>Odpowiedź...</p> x 5.", structure: "<h3>Pytanie</h3><p>Odpowiedź</p>" },
  digest:  { label: "Przegląd newsów",    system: "Format: digest tygodnia. 5 podsumowanych newsów jako osobne sekcje <h2>.", userHint: "Struktura: <h2>1. Tytuł newsa</h2><p>Podsumowanie...</p> x 5.", structure: "<h2>1. Tytuł</h2><p>...</p> x 5" },
  opinion: { label: "Opinia / komentarz", system: "Format: artykuł opinii. Argumenty za, przeciw, osobista konkluzja.", userHint: "Pisz w pierwszej osobie. Struktura: <h2>Kontekst</h2><h2>Argumenty za</h2><h2>Argumenty przeciw</h2><h2>Moja opinia</h2>.", structure: "<h2>Argumenty za</h2><h2>Przeciw</h2><h2>Opinia</h2>" },
};

// personas
export const PERSONAS = {
  journalist: { label: "Dziennikarz",    system: "Jesteś polskim dziennikarzem technologicznym. Obiektywny, oparty na faktach, cytujesz źródła." },
  marketer:   { label: "Marketer",       system: "Jesteś polskim content marketerem B2B. Perswazyjny, benefit-oriented, z call-to-action." },
  technical:  { label: "Technical writer",system: "Jesteś polskim technical writerem. Precyzyjny, definiujesz terminy, podajesz konkrety." },
  ceo:        { label: "CEO / Founder",  system: "Jesteś CEO platformy e-commerce. Strategiczny, big-picture, dzielisz się insightami branżowymi." },
  customer:   { label: "Klient / User",  system: "Jesteś sprzedawcą na marketplace. Praktyczny, first-person, opisujesz realne doświadczenia." },
};

// tones
export const TONES = {
  casual:      { label: "Swobodny",    instruction: "Pisz w stylu konwersacyjnym, jakbyś rozmawiał z kolegą przy kawie. Używaj prostego języka." },
  formal:      { label: "Formalny",    instruction: "Profesjonalny, biznesowy ton. Formalny język, pełne zdania, bez slangu." },
  educational: { label: "Edukacyjny",  instruction: "Wyjaśniaj każdy termin. Podawaj przykłady. Strukturyzuj logicznie jak podręcznik." },
  urgent:      { label: "Pilny / news",instruction: "Pisz z poczuciem pilności. Dlaczego to WAŻNE TERAZ. Krótkie, mocne zdania." },
};

// languages
export const LANGS = {
  pl: { label: "Polski", out: "Po polsku.", minWords: 300 },
  en: { label: "English", out: "In English.", minWords: 250 },
};

// defaults
export const DEF_PERSONA = "journalist";
export const DEF_TONE = "casual";
export const DEF_FORMAT = "article";
export const DEF_LANG = "pl";

// few-shot examples per format
function exampleJson(format, lang) {
  const en = lang === "en";
  if (format === "list") return en
    ? '{"title":"Top 5 E-Commerce Tools for 2026","desc":"The best tools for online sellers. Comparison, features, pricing.","keywords":"e-commerce, tools, automation","body":"<ol><li><h3>Tool One</h3><p>Description...</p></li></ol>"}'
    : '{"title":"Top 5 narzędzi e-commerce na 2026 rok","desc":"Najlepsze narzędzia dla sprzedawców online. Porównanie, funkcje, ceny.","keywords":"e-commerce, narzędzia, automatyzacja","body":"<ol><li><h3>Narzędzie 1</h3><p>Opis...</p></li></ol>"}';
  if (format === "howto") return en
    ? '{"title":"How to Start a Dropshipping Business: Step-by-Step Guide","desc":"Complete guide to starting dropshipping. From niche selection to first sale.","keywords":"dropshipping, guide, e-commerce","body":"<h2>Step 1: Choose a Niche</h2><p>Start by researching...</p><h2>Step 2: Find Suppliers</h2><p>Look for...</p>"}'
    : '{"title":"Jak zacząć dropshipping: poradnik krok po kroku","desc":"Kompletny poradnik zakładania dropshippingu. Od wyboru niszy do pierwszej sprzedaży.","keywords":"dropshipping, poradnik, e-commerce","body":"<h2>Krok 1: Wybierz niszę</h2><p>Zacznij od researchu...</p><h2>Krok 2: Znajdź dostawców</h2><p>Szukaj...</p>"}';
  // default article example
  return en
    ? '{"title":"AI Revolution in E-Commerce: What Sellers Need to Know","desc":"How AI is transforming online retail. Automation, personalization, and new tools for sellers.","keywords":"AI, e-commerce, automation","body":"<h2>The AI Shift</h2><p>Artificial intelligence is changing... <strong>key trends</strong> include...</p><h2>Key Takeaways</h2><ul><li>Personalization</li><li>Automation</li></ul><h2>Conclusion</h2><p>Companies that adopt AI...</p>"}'
    : '{"title":"Jak AI zmienia e-commerce: co sprzedawcy muszą wiedzieć","desc":"Jak sztuczna inteligencja zmienia handel online. Automatyzacja, personalizacja i nowe narzędzia.","keywords":"AI, e-commerce, automatyzacja, sprzedaż","body":"<h2>Rewolucja AI</h2><p>Sztuczna inteligencja zmienia... <strong>kluczowe trendy</strong> to...</p><h2>Wnioski</h2><ul><li>Personalizacja</li><li>Automatyzacja</li></ul><h2>Podsumowanie</h2><p>Firmy które wdrożą AI...</p>"}';
}

export function buildPrompt(opts = {}) {
  const fmt = FORMATS[opts.format] || FORMATS[DEF_FORMAT];
  const persona = PERSONAS[opts.persona] || PERSONAS[DEF_PERSONA];
  const tone = TONES[opts.tone] || TONES[DEF_TONE];
  const lang = LANGS[opts.lang] || LANGS[DEF_LANG];
  const isRss = !!opts.rssTitle;

  const system = [
    persona.system,
    tone.instruction,
    fmt.system,
    `\nKażda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.`,
    `\nPrzykład poprawnej odpowiedzi:\n${exampleJson(opts.format || DEF_FORMAT, opts.lang || DEF_LANG)}`,
    `\n${fmt.structure} Min. ${lang.minWords} słów. ${lang.out}`,
  ].filter(Boolean).join("\n");

  let user;
  if (isRss) {
    user = `Napisz artykuł SEO${opts.lang === "en" ? " in English" : " po polsku"} na podstawie newsa.\n\nORYGINALNY NEWS:\nTytuł: ${opts.rssTitle}\nTreść: ${opts.rssSnippet}\n\n${fmt.userHint}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
  } else {
    user = `Napisz artykuł SEO${opts.lang === "en" ? " in English" : " po polsku"}.\n\nTemat: "${opts.topic}"\n\n${fmt.userHint}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
  }

  return { system, user, lang, fmt, persona, tone };
}

// --- validation ---
export function validate(data, raw, minWords = 200) {
  const issues = [];
  const b = data?.body || raw || "";
  const words = b.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const hasH2 = /<h2[^>]*>/i.test(b);
  const d = (data?.desc || "").trim();
  if (!data?.title) issues.push("brak tytułu");
  if (!data?.body) issues.push("brak treści");
  if (words < minWords) issues.push(`słów ${words} (min ${minWords})`);
  if (!hasH2) issues.push("brak <h2>");
  if (d.length < 40) issues.push(`desc za krótkie (${d.length})`);
  // readability: FOG-like index (0-100, higher = harder)
  const sentences = Math.max(1, b.replace(/<[^>]+>/g, " ").split(/[.!?]+/).filter(Boolean).length);
  const complexWords = b.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 6).length;
  const fog = Math.min(100, Math.round(0.4 * ((words / sentences) + 100 * (complexWords / words))));
  const readability = fog <= 40 ? "łatwy" : fog <= 60 ? "średni" : "trudny";
  return { ok: issues.length === 0, issues, words, hasH2, fog, readability };
}

// --- streaming ---
export async function streamResponse(res, indent = "  ") {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "", tick = 0;
  let batch = "", lastFlush = Date.now();
  const FLUSH_MS = 80;
  function flushBatch() {
    if (!batch) return;
    if (_jsonMode) {
      emitJSON("token", { text: batch });
    } else {
      process.stdout.write(`\n[CHUNK] ${batch.slice(0, 40)}`);
    }
    batch = "";
  }
  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const j = t.slice(5).trim();
        if (j === "[DONE]") continue;
        try {
          const p = JSON.parse(j);
          const d = p.choices?.[0]?.delta?.content;
          if (d) { full += d; tick++; batch += d; }
        } catch {}
      }
      if (batch.length >= 120 || (batch && Date.now() - lastFlush > FLUSH_MS)) {
        flushBatch();
        lastFlush = Date.now();
      }
    } catch (e) {
      if (!_jsonMode) console.error(`\n  [streamResponse error] ${e.message}`);
      break;
    }
  }
  flushBatch();
  if (!_jsonMode) process.stdout.write(`\r${indent}→ Strumień: ${full.length} znaków (gotowe)    \n`);
  return full;
}

// --- slugify ---
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0, 60);
}

// --- html builder ---
export function buildHtml(data, raw, topic, model, extra = {}) {
  const t = data?.title || topic;
  const d = data?.desc || "";
  const k = data?.keywords || "";
  let body = (data?.body || raw || "").replace(/```html?\n?|```$/gmi, "").trim();
  if (extra.sourceLink && !body.includes(extra.sourceLink)) {
    body += `\n\n<h2>Źródło</h2>\n<p><a href="${extra.sourceLink}" rel="nofollow">${esc(extra.sourceLabel || extra.sourceLink)}</a></p>`;
  }
  const slug = slugify(t);
  const fname = `articles/${slug}.html`;
  const dateISO = new Date().toISOString();
  const datePL = new Date().toLocaleDateString("pl-PL");
  const pageUrl = `${BASE}/articles/${slug}.html`;

  // related articles (internal linking)
  let relatedHtml = "";
  try {
    const gen = loadGen();
    const related = Object.entries(gen)
      .filter(([, info]) => info.slug !== slug)
      .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""))
      .slice(0, 3);
    if (related.length > 0) {
      relatedHtml = `\n\n<div class="related-section">\n<h2>Powiązane artykuły</h2>\n<ul>\n${related.map(([, info]) => {
        const rt = esc((info.slug || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80));
        return `  <li><a href="${BASE}/articles/${info.slug}.html">${rt}</a></li>`;
      }).join("\n")}\n</ul>\n</div>`;
      body += relatedHtml;
    }
  } catch {}

  // schema.org
  const ldArticle = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": t, "description": d,
    "datePublished": dateISO, "dateModified": dateISO,
    "author": { "@type": "Organization", "name": "KROKIET NEWS" },
    "publisher": { "@type": "Organization", "name": "KROKIET NEWS", "url": BASE },
    "mainEntityOfPage": pageUrl
  };
  const ldjsons = [JSON.stringify(ldArticle)];

  // FAQ schema for --format faq
  if (extra.format === "faq") {
    const faqPairs = [];
    const re = /<h3[^>]*>\s*(.+?)\s*<\/h3>\s*<p[^>]*>\s*([\s\S]*?)\s*<\/p>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      faqPairs.push({ question: m[1].replace(/<[^>]+>/g, "").trim(), answer: m[2].replace(/<[^>]+>/g, " ").trim() });
    }
    if (faqPairs.length > 0) {
      ldjsons.push(JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqPairs.map(f => ({ "@type": "Question", "name": f.question, "acceptedAnswer": { "@type": "Answer", "text": f.answer } }))
      }));
    }
  }

  const sourceHtml = extra.sourceLink
    ? ` · źródło: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a>`
    : "";

  // reading time
  const wordCount = (body || "").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t)} — KROKIET NEWS</title>
<meta name="description" content="${esc(d)}">
<meta name="keywords" content="${esc(k)}">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(d)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(t)}">
<meta name="twitter:description" content="${esc(d)}">
<script type="application/ld+json">${ldjsons.join("\n")}</script>
<style>${ARTICLE_CSS}</style>
</head>
<body>
<header class="term-header">//====[ KROKIET NEWS ]====\\\\</header>
${TERM_NAV}
<div class="term-wrap">
<h1 class="glitch" data-text="${esc(t)}">${esc(t)}</h1>
<div class="meta-line"><span>[ ${datePL} ]</span><span>[ ${readMin} min ]</span><span>[ ${model} ]</span><span id="articleViews" data-slug="${slug}">— odsłon</span></div>
<article>${body}</article>
${sourceHtml ? `<div class="article-source">&gt; source: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a></div>` : ''}
</div>
<footer class="term-footer">[STATUS] NET-LINK ACTIVE &mdash; ${slug} &mdash; KROKIET NEWS</footer>
<script>var aS="${slug}";fetch("${FB}/articles/"+aS+".json").then(function(r){return r.json()}).then(function(c){var n=(c||0)+1,e=document.getElementById("articleViews");if(e)e.textContent="\ud83d\udc41 "+n+" ods\u0142on";fetch("${FB}/articles/"+aS+".json",{method:"PUT",body:JSON.stringify(n)})}).catch(function(){})</script>
</body>
</html>`;
  return { html, fname, body, slug, artTitle: t, pageUrl };
}

// --- Google Indexing API ---
export async function googleIndexingPing(pageUrl) {
  const key = process.env.GOOGLE_INDEXING_KEY;
  if (!key) { console.log(`  ${C.dim}→ Google Indexing: brak GOOGLE_INDEXING_KEY (pomijam)${C.rst}`); return; }
  try {
    const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ url: pageUrl, type: "URL_UPDATED" }),
    });
    if (res.ok) console.log(`  ${C.grn}→ Google Indexing: zgłoszony ✅${C.rst}`);
    else { const e = await res.text(); console.log(`  ${C.ylw}→ Google Indexing: ${res.status} ${e.slice(0, 100)}${C.rst}`); }
  } catch (e) { console.log(`  ${C.ylw}→ Google Indexing: ${e.message}${C.rst}`); }
}

// --- git ---
export function gitPush(files, msg) {
  if (_jsonMode) emitJSON("info", { tag: "git", msg: "Commit + push...", color: "ylw" });
  else console.log(`  ${C.ylw}→ Commit + push...${C.rst}`);
  const safeMsg = msg.replace(/"/g, "\\\"");
  try {
    execSync(`git add ${files}`, { cwd: ".", encoding: "utf8" });
    const c = execSync(`git commit -m "${safeMsg}"`, { cwd: ".", encoding: "utf8" });
    if (!_jsonMode) console.log(`  → ${c.toString().trim()}`);
    execSync(`git push`, { cwd: ".", encoding: "utf8" });
    if (_jsonMode) emitJSON("info", { tag: "git", msg: "Pushnięte", color: "grn" });
    else console.log(`  ${C.grn}→ Pushnięte ✅${C.rst}`);
    return true;
  } catch (e) {
    const err = e.stderr?.toString().slice(0, 200) || e.message;
    if (_jsonMode) emitJSON("info", { tag: "git", msg: `Błąd: ${err}`, color: "red" });
    else console.log(`  ${C.red}→ Git błąd: ${err}${C.rst}`);
    return false;
  }
}

// --- index / sitemap generators ---
const BASE = "https://pkrokosz.github.io/smartbuyers";
export const FB = "https://krokiet-news-default-rtdb.europe-west1.firebasedatabase.app/krokiet_news";
export function fbInc(path) {
  return fetch(`${FB}/${path}.json`).then(r => r.json()).then(v => {
    const n = (v || 0) + 1;
    fetch(`${FB}/${path}.json`, { method: "PUT", body: JSON.stringify(n) }).catch(() => {});
    return n;
  }).catch(() => 0);
}
export function fbArticlePush(slug, title, date, tag, body, url) {
  const entry = { t: title, d: date, g: tag, b: body, u: url };
  return fetch(`${FB}/index/${slug.replace(/\./g,"_")}.json`, { method: "PUT", body: JSON.stringify(entry) }).catch(() => {});
}
export function pushArticleToFirebase(slug, title, bodyHtml, url, sourceUrl, optDate) {
  const date = optDate || new Date().toLocaleDateString("pl-PL");
  const sections = [];
  let html = bodyHtml;
  while (html.length > 0) {
    const hm = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(html);
    let heading = "", text = "";
    if (hm) {
      heading = hm[1].replace(/<[^>]*>/g, "").trim();
      const idx = html.indexOf(hm[0]);
      if (idx > 0) text = html.slice(0, idx);
      html = html.slice(idx + hm[0].length);
      const nextH = /<h[23]/i.exec(html);
      if (nextH) { text = text || html.slice(0, nextH.index); html = html.slice(nextH.index); }
      else { text = text || html; html = ""; }
    } else { text = html; html = ""; }
    text = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (text && text.length > 0) sections.push([heading, text]);
  }
  const lc = (sourceUrl || slug || "").toLowerCase();
  let tag = "ART";
  if (/techcrunch|google|amazon|nvidia|ai|deepmind|claude|anthropic|openai|chip/.test(lc)) tag = "TECH";
  else if (/reddit/.test(lc)) tag = "REDDIT";
  return fbArticlePush(slug, title, date, tag, sections, url);
}

const TERM_NAV = `<div class="term-nav">
  <a href="/">home</a>
  <a href="/articles/feed.xml">rss</a>
</div>`;

export function generateIndex() {
  const gen = loadGen();
  const seen = new Set(Object.values(gen).map(x => x.slug));
  const all = [];

  for (const [url, info] of Object.entries(gen)) {
    if (!existsSync(`articles/${info.slug}.html`)) continue;
    all.push({ slug: info.slug, title: info.title, date: info.date, source: url.startsWith("http") ? url : null });
  }

  function extractArticleBody(slug) {
    try {
      const f = readFileSync(`articles/${slug}.html`, "utf8");
      const m = f.match(/<article>([\s\S]*?)<\/article>/);
      if (!m) return "";
      return m[1].replace(/<div class="related-section">[\s\S]*?<\/div>\s*$/g, "");
    } catch { return ""; }
  }

  try {
    const ls = execSync("cmd /c \"dir /b articles\\*.html 2>nul\"", { encoding: "utf8", timeout: 3000 }).trim();
    for (const f of ls.split(/\r?\n/).filter(f => f.endsWith(".html") && f !== "index.html")) {
      const slug = f.replace(".html", "");
      if (!seen.has(slug)) {
        let date = new Date().toISOString();
        try { const gd = execSync(`git log --follow --diff-filter=A -1 --format=%aI "articles/${f}"`, { encoding: "utf8", timeout: 3000 }).trim(); if (gd) date = gd; } catch {}
        all.push({ slug, title: slug, date, source: null });
      }
    }
  } catch {}

  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function tagFor(s) {
    const lc = s.toLowerCase();
    if (/techcrunch|google|amazon|nvidia|ai|deepmind|claude|anthropic|openai|chip/.test(lc)) return "TECH";
    if (/reddit/.test(lc)) return "REDDIT";
    return "ART";
  }

  function htmlToSections(html) {
    const sections = [];
    let first = true;
    while (html.length > 0) {
      const h2m = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
      let heading = "";
      let text = "";
      if (h2m) {
        heading = h2m[1].replace(/<[^>]*>/g, "").trim();
        const idx = html.indexOf(h2m[0]);
        if (first && idx > 0) text = html.slice(0, idx);
        html = html.slice(idx + h2m[0].length);
        const nextH2 = /<h2/i.exec(html);
        if (nextH2) {
          text = text || html.slice(0, nextH2.index);
          html = html.slice(nextH2.index);
        } else { text = text || html; html = ""; }
      } else {
        text = html; html = "";
      }
      text = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (text && text.length > 0) sections.push([heading, text]);
      first = false;
    }
    return sections.length ? sections : [["", extractArticleBody(all[0]?.slug || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200)]];
  }

  const count = all.length;

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KROKIET NEWS</title>
<meta name="description" content="Terminal news feed">
<meta property="og:title" content="KROKIET NEWS">
<meta property="og:description" content="Terminal news feed">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE}/">
<meta name="twitter:card" content="summary">
<style>${TERMINAL_CSS}</style>
</head>
<body>
<div class="scanlines"></div>
<div id="root">

  <div id="boot"><pre id="bootText"></pre></div>

  <div id="menu">
    <div class="wrap">
      <div class="brand">KROKIET NEWS</div>
      <div class="rule">////////////////////////////</div>
      <div class="sub">system feedu aktywny — <span id="totalCount">${count}</span> sygnałów · <span id="pageViews">—</span> wizyt</div>
      <div id="menuItems"></div>
      <div class="hint-bar">
        <kbd>&uarr;</kbd><kbd>&darr;</kbd> nawigacja &nbsp; <kbd>enter</kbd> wybierz &nbsp; lub kliknij myszką
      </div>
    </div>
  </div>

  <div id="app">
    <header class="top">
      //====[ KROKIET NEWS ]====\\\\
      <div class="nav">
        <span class="on">home</span><span>archiwum</span><span>rss</span>
        <span id="backToMenuBtn" style="color:var(--muted);cursor:pointer;margin-left:1.5rem">&lsaquo; menu</span>
      </div>
    </header>
    <div class="app-body">
      <div id="rail">
        <div class="inner">
          <span class="collapse-rail" id="collapseRail" title="zwiń pasek">&lsaquo;</span>
          <span class="back" id="backBtn">&lsaquo; wróć do menu</span>
          <div id="railItems"></div>
        </div>
      </div>
      <div id="railHandle" title="rozwiń pasek">&rsaquo;</div>
      <div id="listPane">
        <div class="feed-title">wszystkie sygnały</div>
        <div class="feed-meta">terminal news feed — AI-generated — <span id="countLabel">${count}</span> sygnałów</div>
        <div id="rows"></div>
      </div>
      <div id="articlePane"></div>
    </div>
  </div>

</div>

<script>
(function(){
var ARTICLES=[];
var _fbLoaded=false;
var _showingMenu=false;
(function(){fetch("${FB}/index/.json").then(function(r){return r.json()}).then(function(data){
  if(!data){_fbLoaded=true;return}
  var slugs=Object.keys(data);
  for(var i=0;i<slugs.length;i++){
    var s=slugs[i],a=data[s];
    if(!a||!a.t)continue;
    ARTICLES.push({slug:s,title:a.t,date:a.d,tag:a.g,body:a.b,url:a.u});
  }
  ARTICLES.sort(function(a,b){return b.d.localeCompare(a.d);});
  filteredArticles=ARTICLES.slice();
  _fbLoaded=true;
  if(!_showingMenu)renderMenu();
}).catch(function(){_fbLoaded=true;if(!_showingMenu)renderMenu();});})();
var rowIdx=0;
var subMenuIdx=0;
var todayDate=new Date().toLocaleDateString("pl-PL");
var currentFilter={type:"all"};
var filteredArticles=ARTICLES.slice();

/* ── BOOT ── */
var bootLines=[
  "> inicjalizacja...",
  "> \u0142adowanie Firebase...",
  "> synchronizacja sygna\u0142\xf3w ["+ARTICLES.length+"/"+ARTICLES.length+"]",
  "> po\u0142\u0105czono z KROKIET NEWS"
];
var bootEl=document.getElementById("bootText");
var bi=0;
function typeBootLine(){
  if(bi>=bootLines.length){
    function showMenu_(){
      document.getElementById("boot").style.display="none";
      document.getElementById("menu").style.display="flex";
      _showingMenu=true;
      renderMenu();
    }
    if(_fbLoaded){setTimeout(showMenu_,450);}
    else{
      var dot=document.createElement("div");
      dot.className="line-done";
      dot.textContent="> \u0142adowanie danych...";
      bootEl.appendChild(dot);
      var iv=setInterval(function(){if(_fbLoaded){clearInterval(iv);showMenu_();}},200);
    }
    return;
  }
  var line=bootLines[bi],ci=0;
  var span=document.createElement("div");
  span.className="line-done";
  bootEl.appendChild(span);
  var iv=setInterval(function(){
    span.textContent=line.slice(0,ci+1);ci++;
    if(ci>=line.length){clearInterval(iv);bi++;setTimeout(typeBootLine,180);}
  },14);
}
typeBootLine();
(function(){fetch("${FB}/home.json").then(function(r){return r.json()}).then(function(c){
  var n=(c||0)+1,e=document.getElementById("pageViews");
  if(e)e.textContent=n+" wizyt";
  fetch("${FB}/home.json",{method:"PUT",body:JSON.stringify(n)});
}).catch(function(){});})();

/* ── MENU ── */
var menuOptions=["przegl\u0105daj wszystko","nowe (dzi\u015b)","tematy / kategorie","archiwum","rss"];
var menuIdx=0;
function renderMenu(){
  var c=document.getElementById("menuItems");c.innerHTML="";
  menuOptions.forEach(function(opt,i){
    var d=document.createElement("div");
    d.className="menu-item"+(i===menuIdx?" active":"");
    d.innerHTML='<span class="idx">['+(i+1)+']</span><span>'+opt+'</span>';
    d.onclick=function(){menuIdx=i;renderMenu();enterMenu(i);};
    c.appendChild(d);
  });
}
function enterMenu(opt){
  subMenuIdx=0;
  if(opt===0){currentFilter={type:"all"};}
  else if(opt===1){currentFilter={type:"today",date:todayDate};}
  else if(opt===2){renderTagMenu();return;}
  else if(opt===3){currentFilter={type:"archive",excludeDate:todayDate};}
  else if(opt===4){window.open("/articles/feed.xml","_blank");return;}
  applyFilter();
}
function applyFilter(){
  var f=currentFilter;
  if(f.type==="all")filteredArticles=ARTICLES.slice();
  else if(f.type==="today")filteredArticles=ARTICLES.filter(function(a){return a.date===f.date;});
  else if(f.type==="archive")filteredArticles=ARTICLES.filter(function(a){return a.date!==f.excludeDate;});
  else if(f.type==="tag")filteredArticles=ARTICLES.filter(function(a){return a.tag===f.tag;});
  rowIdx=0;
  document.getElementById("menu").style.display="none";
  document.getElementById("app").style.display="flex";
  document.getElementById("listPane").style.display="block";
  document.getElementById("articlePane").style.display="none";
  document.getElementById("articlePane").innerHTML="";
  setRail(false);
  renderRows();
}

/* ── SUB-MENU (tagi) ── */
function renderTagMenu(){
  var tags=[];
  ARTICLES.forEach(function(a){if(tags.indexOf(a.tag)===-1)tags.push(a.tag);});
  var c=document.getElementById("menuItems");c.innerHTML="";
  // back link
  var back=document.createElement("div");
  back.className="menu-item active";
  back.innerHTML='<span class="idx">[\u2039]</span><span>wstecz</span>';
  back.onclick=function(){renderMenu();};
  c.appendChild(back);
  // tag items
  tags.forEach(function(t,i){
    var d=document.createElement("div");
    d.className="menu-item";
    d.innerHTML='<span class="idx">['+(i+1)+']</span><span>kategoria: '+t+'</span>';
    d.onclick=function(){enterTagMenu(t);};
    c.appendChild(d);
  });
  subMenuIdx=0;
}
function enterTagMenu(tag){
  currentFilter={type:"tag",tag:tag};
  applyFilter();
}

/* ── LIST ── */
function renderRows(){
  var title=document.querySelector(".feed-title");
  var meta=document.querySelector(".feed-meta");
  var f=currentFilter;
  if(f.type==="all"){title.textContent="wszystkie sygna\u0142y";meta.innerHTML='terminal news feed \u2014 AI-generated \u2014 <span id="countLabel">'+filteredArticles.length+'</span> sygna\u0142\xf3w';}
  else if(f.type==="today"){title.textContent="nowe \u2014 dzi\u015b";meta.innerHTML='dzisiejsze sygna\u0142y \u2014 <span id="countLabel">'+filteredArticles.length+'</span>';}
  else if(f.type==="archive"){title.textContent="archiwum";meta.innerHTML='starsze sygna\u0142y \u2014 <span id="countLabel">'+filteredArticles.length+'</span>';}
  else if(f.type==="tag"){title.textContent="kategoria: "+f.tag;meta.innerHTML='sygna\u0142y z tagiem '+f.tag+' \u2014 <span id="countLabel">'+filteredArticles.length+'</span>';}
  document.getElementById("countLabel").textContent=filteredArticles.length;
  var c=document.getElementById("rows");c.innerHTML="";
  if(!filteredArticles.length){
    c.innerHTML='<div style="text-align:center;padding:2rem;color:var(--muted)">brak sygna\u0142\xf3w dla tego filtra</div>';
    renderRail();return;
  }
  filteredArticles.forEach(function(a,i){
    var r=document.createElement("div");
    r.className="row"+(i===rowIdx?" active":"");
    r.innerHTML='<span class="car">&rsaquo;</span><span class="tag tag-'+a.tag+'">'+a.tag+'</span><span class="date">'+a.date+'</span><span class="title">'+a.title+'</span>';
    r.onclick=function(){rowIdx=i;openArticle(i);};
    c.appendChild(r);
  });
  renderRail();
}
function renderRail(){
  var c=document.getElementById("railItems");c.innerHTML="";
  filteredArticles.forEach(function(a,i){
    var r=document.createElement("div");
    r.className="r-row"+(i===rowIdx?" active":"");
    r.textContent=a.title;
    r.onclick=function(){rowIdx=i;openArticle(i);};
    c.appendChild(r);
  });
}
document.getElementById("backBtn").onclick=backToMenu;
document.getElementById("backToMenuBtn").onclick=backToMenu;
document.getElementById("collapseRail").onclick=function(){setRail(false);};
document.getElementById("railHandle").onclick=function(){setRail(true);};
function setRail(open){
  document.getElementById("rail").classList.toggle("open",open);
  document.getElementById("railHandle").classList.toggle("show",!open);
}

/* ── HEADER NAV ── */
(function(){
  var navs=document.querySelectorAll("header.top .nav span");
  navs[0].onclick=backToMenu;
  navs[1].onclick=function(){currentFilter={type:"archive",excludeDate:todayDate};applyFilter();};
  navs[2].onclick=function(){window.open("/articles/feed.xml","_blank");};
})();

/* ── NAV ── */
function backToMenu(){
  document.getElementById("app").style.display="none";
  document.getElementById("menu").style.display="flex";
  currentFilter={type:"all"};
  filteredArticles=ARTICLES.slice();
  renderMenu();
}

/* ── ARTICLE ── */
function openArticle(i){
  rowIdx=i;
  var a=filteredArticles[i];
  if(!a)return;
  setRail(true);
  document.getElementById("listPane").style.display="none";
  var pane=document.getElementById("articlePane");
  pane.style.display="block";
  pane.innerHTML='<div class="a-meta">'+a.tag+' &middot; '+a.date+'</div><h1>'+a.title+'</h1><div class="body" id="bodyStream"></div>';
  renderRail();
  streamBody(a.body);
}
function closeArticle(){
  setRail(false);
  document.getElementById("listPane").style.display="block";
  document.getElementById("articlePane").style.display="none";
  document.getElementById("articlePane").innerHTML="";
}
function streamBody(sections){
  var target=document.getElementById("bodyStream");
  var sIdx=0;
  function nextSection(){
    if(sIdx>=sections.length)return;
    var sec=sections[sIdx];
    var heading=sec[0],text=sec[1];
    if(heading){
      var h=document.createElement("h2");
      target.appendChild(h);
      typeInto(h,heading,afterHeading);
    }else{afterHeading();}
    function afterHeading(){
      var p=document.createElement("p");
      var cursor=document.createElement("span");
      cursor.className="cursor";
      target.appendChild(p);
      target.appendChild(cursor);
      var words=text.split(" ");
      var wi=0;
      var iv=setInterval(function(){
        p.textContent=words.slice(0,wi+1).join(" ");
        wi++;
        if(wi>=words.length){clearInterval(iv);cursor.remove();sIdx++;setTimeout(nextSection,150);}
      },28);
    }
  }
  nextSection();
}
function typeInto(el,text,done){
  var i=0;
  var iv=setInterval(function(){el.textContent=text.slice(0,i+1);i++;if(i>=text.length){clearInterval(iv);done&&done();}},16);
}

/* ── KEYBOARD ── */
document.addEventListener("keydown",function(e){
  var menuVisible=document.getElementById("menu").style.display==="flex";
  var appVisible=document.getElementById("app").style.display==="flex";
  var articleOpen=document.getElementById("articlePane").style.display==="block";
  // check if sub-menu is rendered (has back link as first item)
  var inSubMenu=menuVisible&&document.querySelector(".menu-item .idx")&&document.querySelector(".menu-item .idx").textContent.indexOf("\u2039")!==-1;
  if(menuVisible&&!inSubMenu){
    if(e.key==="ArrowDown"){menuIdx=(menuIdx+1)%menuOptions.length;renderMenu();}
    if(e.key==="ArrowUp"){menuIdx=(menuIdx-1+menuOptions.length)%menuOptions.length;renderMenu();}
    if(e.key==="Enter")enterMenu(menuIdx);
  }else if(inSubMenu){
    var total=document.querySelectorAll("#menuItems .menu-item").length;
    if(e.key==="ArrowDown"){subMenuIdx=(subMenuIdx+1)%total;updateSubMenuCursor();}
    if(e.key==="ArrowUp"){subMenuIdx=(subMenuIdx-1+total)%total;updateSubMenuCursor();}
    if(e.key==="Enter"){document.querySelectorAll("#menuItems .menu-item")[subMenuIdx].click();}
    if(e.key==="Escape"||e.key==="Backspace")renderMenu();
  }else if(appVisible&&articleOpen){
    if(e.key==="Escape"||e.key==="Backspace")closeArticle();
  }else if(appVisible){
    if(e.key==="Escape"||e.key==="Backspace")backToMenu();
    if(e.key==="ArrowDown"){rowIdx=Math.min(rowIdx+1,filteredArticles.length-1);renderRows();}
    if(e.key==="ArrowUp"){rowIdx=Math.max(rowIdx-1,0);renderRows();}
    if(e.key==="Enter")openArticle(rowIdx);
  }
});
function updateSubMenuCursor(){
  var items=document.querySelectorAll("#menuItems .menu-item");
  items.forEach(function(el,i){el.className="menu-item"+(i===subMenuIdx?" active":"");});
}

})();
</script>
</body>
</html>`;
  writeFileSync("index.html", html, "utf8");
  return count;
}

export function generateSitemap() {
  const gen = loadGen();
  let urls = "";
  for (const [, info] of Object.entries(gen)) {
    urls += `  <url><loc>${BASE}/articles/${info.slug}.html</loc><lastmod>${(info.date||"").slice(0,10)}</lastmod><changefreq>weekly</changefreq></url>\n`;
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE}/</loc><lastmod>${new Date().toISOString().slice(0,10)}</lastmod><priority>1.0</priority></url>
${urls}</urlset>`;
  writeFileSync("articles/sitemap.xml", xml, "utf8");
}

// --- RSS feed for the blog ---
export function generateFeed() {
  const gen = loadGen();
  const all = Object.entries(gen).sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""));
  const now = new Date().toUTCString();

  let items = "";
  for (const [url, info] of all.slice(0, 20)) {
    const title = esc((info.slug || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100));
    const date = info.date ? new Date(info.date).toUTCString() : now;
    const link = `${BASE}/articles/${info.slug}.html`;
    items += `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${date}</pubDate>
      <source url="${url}">${url.slice(0, 60)}</source>
    </item>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>KROKIET NEWS</title>
    <link>${BASE}/</link>
    <description>Automatycznie generowane artykuły SEO z RSS feedów. B2B dropshipping, e-commerce, AI.</description>
    <language>pl</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${BASE}/articles/feed.xml" rel="self" type="application/rss+xml"/>
${items}  </channel>
</rss>`;
  writeFileSync("articles/feed.xml", xml, "utf8");
  return all.length;
}

export const ARTICLE_CSS = `
:root{--green:#0f0;--green-dim:#0a0;--cyan:#0ff;--bg:#050505;--panel:#0a0a0a;--border:#1a3a1a;--text:#0f0;--dim:#0a0;--font:'Courier New',Courier,monospace}
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased;font-size:15px}
body{font-family:var(--font);color:var(--text);background:var(--bg);line-height:1.65;min-height:100vh;position:relative}
body::before{content:'';position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;background:repeating-linear-gradient(0deg,rgba(0,0,0,.06) 0px,rgba(0,0,0,.06) 2px,transparent 2px,transparent 4px);animation:scan 1s linear infinite}
@keyframes scan{0%{background-position:0 0}100%{background-position:0 4px}}
@keyframes flicker{0%,100%{opacity:1}50%{opacity:.82}}
@keyframes glitch{0%{transform:translate(0);text-shadow:none}20%{transform:translate(-1px,1px);text-shadow:-1px 0 var(--cyan)}40%{transform:translate(1px,-1px);text-shadow:1px 0 var(--green)}60%{transform:translate(-1px,1px)}80%{transform:translate(1px,-1px)}100%{transform:translate(0);text-shadow:none}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.term-header,.term-footer{animation:flicker 3s infinite;color:var(--green-dim);font-size:.82rem;text-align:center;padding:.75rem 1rem;border-top:1px solid var(--border);border-bottom:1px solid var(--border);letter-spacing:.04em}
.term-header{margin-bottom:1.5rem}
.term-footer{margin-top:2.5rem}
.term-nav{display:flex;justify-content:center;gap:1.5rem;padding:.5rem 0;font-size:.8rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
.term-nav a{color:var(--dim);text-decoration:none;transition:color .2s}
.term-nav a:hover,.term-nav a.active{color:var(--green);text-shadow:0 0 6px rgba(0,255,0,.3)}
.term-nav a::before{content:'['}
.term-nav a::after{content:']'}
.term-wrap{max-width:860px;margin:0 auto;padding:.5rem clamp(.8rem,2vw,1.5rem)}
.glitch{display:inline-block;animation:glitch 3.5s infinite;text-shadow:0 0 8px rgba(0,255,0,.35)}
.glitch::before,.glitch::after{content:attr(data-text);position:absolute;top:0;left:0;width:100%;height:100%}
.glitch::before{animation:glitch 3.5s infinite;clip-path:polygon(0 0,100% 0,100% 35%,0 35%);transform:translate(-.03em,-.03em)}
.glitch::after{animation:glitch 2.5s infinite;clip-path:polygon(0 65%,100% 65%,100% 100%,0 100%);transform:translate(.03em,.03em)}
h1{font-size:1.45rem;line-height:1.25;margin-bottom:.6rem;color:var(--green);position:relative}
h2{font-size:1.1rem;margin:2rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--border);color:var(--cyan)}
h3{font-size:1rem;margin:1.5rem 0 .4rem;color:var(--green-dim)}
p{margin:.7rem 0}
ul,ol{margin:.7rem 0;padding-left:1.4rem}
li{margin:.3rem 0}
li::marker{color:var(--dim)}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline;text-shadow:0 0 6px rgba(0,255,255,.3)}
img{max-width:100%;height:auto;border:1px solid var(--border);margin:1rem 0}
blockquote{border-left:3px solid var(--green-dim);padding:.5rem 1rem;margin:1rem 0;color:var(--dim);font-style:italic}
pre,code{background:var(--panel);border:1px solid var(--border);border-radius:3px;font-family:var(--font);font-size:.88em}
code{padding:.1rem .35rem;color:var(--cyan)}
pre{padding:.8rem;overflow-x:auto;line-height:1.5}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.9em}
th,td{padding:.4rem .7rem;border:1px solid var(--border);text-align:left}
th{background:var(--panel);color:var(--cyan)}
.meta-line{display:flex;align-items:center;gap:1.2rem;font-size:.78rem;color:var(--dim);margin-bottom:1.5rem;flex-wrap:wrap}
.article-source{margin:2rem 0 1rem;padding-top:.8rem;border-top:1px solid var(--border);font-size:.78rem;color:var(--dim)}
.article-source a{color:var(--cyan)}
.related-section{margin-top:2rem;padding:1rem;border:1px solid var(--border);background:var(--panel)}
.related-section h2{font-size:.95rem;margin-top:0;color:var(--green)}
.related-section ul{padding-left:1rem;margin-bottom:0}
.related-section li{margin:.3rem 0;font-size:.85rem}
.article-footer{margin-top:2rem;padding-top:.8rem;border-top:1px solid var(--border);font-size:.75rem;color:var(--dim);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem}
.cursor::after{content:'_';animation:blink 1s step-end infinite}
/* ── index feed ── */
.feed-line{display:flex;align-items:baseline;gap:.5rem;padding:.35rem 0;border-bottom:1px solid rgba(0,255,0,.06);font-size:.85rem;flex-wrap:wrap}
.feed-line:hover{background:rgba(0,255,0,.03)}
.feed-num{color:var(--dim);font-size:.75rem;min-width:2.2rem}
.feed-tag{font-size:.65rem;font-weight:700;text-transform:uppercase;padding:.08rem .4rem;border:1px solid;white-space:nowrap}
.feed-tag-tech{border-color:var(--cyan);color:var(--cyan)}
.feed-tag-reddit{border-color:#ff4500;color:#ff4500}
.feed-tag-article{border-color:var(--green-dim);color:var(--green-dim)}
.feed-date{color:var(--dim);font-size:.72rem;min-width:5rem}
.feed-title{flex:1;min-width:200px}
.feed-title a{color:var(--green)}
.feed-title a:hover{color:var(--cyan);text-shadow:0 0 8px rgba(0,255,255,.25)}
.feed-link{font-size:.75rem;color:var(--dim)}
.hero-panel{border:1px solid var(--border);background:var(--panel);padding:1.5rem;margin-bottom:2rem;text-align:center}
.hero-panel h1{font-size:1.6rem;margin-bottom:.3rem}
.hero-panel .sub{font-size:.8rem;color:var(--dim)}
.count-line{font-size:.75rem;color:var(--dim);margin-bottom:1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
.empty-line{text-align:center;padding:2rem;color:var(--dim)}
.newsletter-list{list-style:none;padding:0;margin:1.5rem 0}
.newsletter-list li{padding:.6rem .8rem;border:1px solid var(--border);background:var(--panel);margin-bottom:.5rem}
.newsletter-list li a{color:var(--green);font-size:.95rem}
.newsletter-list li small{color:var(--dim);font-size:.75rem;float:right}
@media(max-width:600px){h1{font-size:1.2rem}.meta-line{font-size:.7rem;gap:.6rem}.feed-line{font-size:.78rem}.term-header,.term-footer{font-size:.7rem}}
@media print{body::before{display:none}body{color:#000;background:#fff}}
`;

export const TERMINAL_CSS = `
:root{--bg:#030706;--panel:#050a08;--fg:#22e07a;--fg-dim:#0e6b3c;--fg-bright:#7dffb0;--cyan:#29d4d4;--cyan-dim:#12615f;--border:#124a2e;--border-dim:#0a2c1c;--muted:#4a6b58;--tag-bg:#071510}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:"Courier New",ui-monospace,monospace;font-size:15px;line-height:1.55}
#root{min-height:100vh;display:flex;flex-direction:column}
::selection{background:var(--fg-dim);color:#000}

.scanlines{pointer-events:none;position:fixed;inset:0;background:repeating-linear-gradient(to bottom,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 1px,rgba(0,0,0,.10) 2px,rgba(0,0,0,0) 3px);z-index:999;opacity:.35;mix-blend-mode:overlay}

.cursor{display:inline-block;width:.55em;height:1em;background:var(--fg-bright);vertical-align:-.15em;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}

#boot{flex:1;display:flex;align-items:center;justify-content:center;padding:2rem}
#boot pre{color:var(--fg-dim);font-size:14px;white-space:pre-wrap;margin:0;max-width:640px}
#boot .line-done{color:var(--fg)}

#menu{flex:1;display:none;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
#menu .wrap{width:100%;max-width:520px}
#menu .brand{text-align:center;margin-bottom:.25rem;font-size:30px;font-weight:bold;letter-spacing:.18em;color:var(--fg-bright);text-shadow:0 0 14px rgba(34,224,122,.35)}
#menu .rule{text-align:center;color:var(--border);letter-spacing:.3em;margin-bottom:.4rem;font-size:13px}
#menu .sub{text-align:center;color:var(--muted);font-size:13px;margin-bottom:2.2rem}
.menu-item{display:flex;align-items:center;gap:.9rem;padding:.65rem 1rem;margin-bottom:.3rem;cursor:pointer;border:1px solid transparent;color:var(--fg-dim);font-size:16px;transition:none}
.menu-item .idx{color:var(--muted);width:1.4em}
.menu-item.active{color:var(--fg-bright);border:1px solid var(--border);background:rgba(34,224,122,.05)}
.menu-item.active .idx{color:var(--fg-bright)}
.menu-item.active::before{content:"›";margin-right:-.4rem;color:var(--fg-bright)}
.menu-item:not(.active)::before{content:" ";margin-right:-.4rem}
.hint-bar{margin-top:2rem;text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--border-dim);padding-top:1rem}
.hint-bar kbd{border:1px solid var(--border);padding:1px 6px;border-radius:3px;color:var(--fg-dim);font-family:inherit;margin:0 2px}

#app{flex:1;display:none;flex-direction:column}
header.top{text-align:center;padding:.9rem 1rem .7rem;color:var(--muted);font-size:13px;letter-spacing:.15em;border-bottom:1px solid var(--border-dim)}
header.top .nav{margin-top:.5rem;font-size:13px}
header.top .nav span{margin:0 .7rem;cursor:pointer;color:var(--fg-dim)}
header.top .nav span.on{color:var(--cyan);text-decoration:underline}
.app-body{flex:1;display:flex;min-height:0}

#listPane{width:100%;max-width:900px;margin:0 auto;padding:1.2rem 1.5rem 3rem;transition:max-width .35s ease}
.feed-title{color:var(--fg-bright);font-size:20px;margin:0 0 .15rem;letter-spacing:.04em}
.feed-meta{color:var(--muted);font-size:12.5px;margin-bottom:1.1rem}
.row{display:grid;grid-template-columns:20px 60px 74px 1fr;align-items:center;gap:.7rem;padding:.5rem .6rem;border:1px solid transparent;cursor:pointer;color:var(--fg-dim);font-size:14px}
.row .car{color:var(--fg-bright);visibility:hidden}
.row.active{background:rgba(41,212,212,.06);border-color:var(--cyan-dim);color:var(--fg-bright)}
.row.active .car{visibility:visible}
.row .tag{font-size:10.5px;border:1px solid var(--border);background:var(--tag-bg);padding:2px 5px;text-align:center;letter-spacing:.05em;color:var(--fg-dim)}
.row.active .tag{color:var(--cyan);border-color:var(--cyan-dim)}
.row .tag.tag-TECH{color:var(--cyan);border-color:var(--cyan-dim)}
.row.active .tag.tag-TECH{color:var(--cyan)}
.row .tag.tag-REDDIT{color:var(--fg-bright);border-color:var(--fg-dim);opacity:.75}
.row.active .tag.tag-REDDIT{color:var(--fg-bright);opacity:1}
.row .tag.tag-ART{color:var(--muted);border-color:var(--muted)}
.row.active .tag.tag-ART{color:var(--fg-dim)}
.row .date{color:var(--muted);font-size:12px}
.row .title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

#rail{width:0;overflow:hidden;border-right:1px solid var(--border-dim);transition:width .35s ease;flex-shrink:0;position:relative}
#rail.open{width:230px}
#rail .inner{width:230px;padding:1rem .8rem}
#rail .back{color:var(--muted);font-size:12px;cursor:pointer;margin-bottom:1rem;display:block}
#rail .back:hover{color:var(--fg)}
#rail .r-row{padding:.4rem .5rem;font-size:12.5px;color:var(--fg-dim);cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-left:2px solid transparent}
#rail .r-row.active{color:var(--cyan);border-left-color:var(--cyan);background:rgba(41,212,212,.05)}
#rail .collapse-rail{position:absolute;right:2px;top:12px;width:18px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--border-dim);cursor:pointer;color:var(--muted);font-size:12px;z-index:5}
#rail .collapse-rail:hover{color:var(--fg)}
#railHandle{width:20px;flex-shrink:0;display:none;align-items:center;justify-content:center;cursor:pointer;color:var(--muted);background:var(--panel);border-right:1px solid var(--border-dim);font-size:13px;user-select:none}
#railHandle:hover{color:var(--fg)}
#railHandle.show{display:flex}

#articlePane{flex:1;min-width:0;padding:1.6rem 2rem 4rem;overflow-y:auto;display:none}
#articlePane .a-meta{color:var(--muted);font-size:12.5px;margin-bottom:.3rem}
#articlePane h1{color:var(--fg-bright);font-size:22px;margin:.2rem 0 1.2rem;border-bottom:1px solid var(--border-dim);padding-bottom:.8rem}
#articlePane .body{max-width:720px;color:#bfe9cf;line-height:1.65}
#articlePane .body h2{color:var(--cyan);font-size:16px;margin:1.6rem 0 .6rem}
#articlePane .body p{margin:0 0 1rem}
@media(max-width:600px){#rail.open{width:160px}#rail .inner{width:160px}.row{grid-template-columns:18px 50px 60px 1fr;font-size:12px;gap:.4rem}}
`;

// ── NB Notebook UUIDs (single source of truth) ──
export const NB_NEWS_ID = "5dd3bcd8-fc51-481e-bffa-fab231a378c3";
export const NB_SOURCES_ID = "9ebb1726-9322-423e-92f4-b081d65218b5";
export const NB_RESEARCH_ID = "7a31df6c-2516-4a0a-a0a6-34403d15f10a";
export const NB_AUDIO_ID = "992ecd72-3d82-4232-82e0-b5ecbd0a7755";
