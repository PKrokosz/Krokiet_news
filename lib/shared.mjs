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

  const navHtml = TERM_NAV.replace('class="active"', '');

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
<style>${TERMINAL_CSS}</style>
</head>
<body>
<header class="term-header">//====[ KROKIET NEWS ]====\\\\</header>
${TERM_NAV}
<div class="term-wrap">
<h1 class="glitch" data-text="${esc(t)}">${esc(t)}</h1>
<div class="meta-line"><span>[ ${datePL} ]</span><span>[ ${readMin} min ]</span><span>[ ${model} ]</span></div>
<article>${body}</article>
${sourceHtml ? `<div class="article-source">&gt; source: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a></div>` : ''}
</div>
<footer class="term-footer">[STATUS] NET-LINK ACTIVE &mdash; ${slug} &mdash; KROKIET NEWS</footer>
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

const TERM_NAV = `<div class="term-nav">
  <a href="${BASE}/">home</a>
  <a href="${BASE}/articles/" class="active">archiwum</a>
  <a href="${BASE}/articles/feed.xml">rss</a>
</div>`;

export function generateIndex() {
  const gen = loadGen();
  const seen = new Set(Object.values(gen).map(x => x.slug));
  const all = [];
  
  // from generated.json (RSS articles)
  for (const [url, info] of Object.entries(gen)) {
    if (!existsSync(`articles/${info.slug}.html`)) continue;
    all.push({ slug: info.slug, title: info.title, date: info.date, source: url.startsWith("http") ? url : null });
  }
  
  // scan articles/ dir for any HTML not tracked in generated.json (topic-based articles)
  function extractTitleFromFile(slug) {
    try {
      const f = readFileSync(`articles/${slug}.html`, "utf8");
      const m = f.match(/<title>([^<]+)<\/title>/);
      if (m) return m[1].replace(/ \u2014 KROKIET NEWS$/, "").trim();
    } catch {}
    return null;
  }
  try {
    const ls = execSync("cmd /c \"dir /b articles\\*.html 2>nul\"", { encoding: "utf8", timeout: 3000 }).trim();
    const files = ls.split(/\r?\n/).filter(f => f.endsWith(".html") && f !== "index.html");
    for (const f of files) {
      const slug = f.replace(".html", "");
      if (!seen.has(slug)) {
        let date = new Date().toISOString();
        try {
          const gitDate = execSync(`git log -1 --format=%aI "articles/${f}"`, { encoding: "utf8", timeout: 3000 }).trim();
          if (gitDate) date = gitDate;
        } catch {}
        const title = extractTitleFromFile(slug);
        all.push({ slug, title, date, source: null });
      }
    }
  } catch {}
  
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  
  const tagClass = s => {
    const lc = s.toLowerCase();
    if (/techcrunch|google|amazon|nvidia|ai|deepmind|claude|anthropic|openai|chip/.test(lc)) return "feed-tag-tech";
    if (/reddit/.test(lc)) return "feed-tag-reddit";
    return "feed-tag-article";
  };
  const tagLabel = s => {
    const lc = s.toLowerCase();
    if (/techcrunch|google|amazon|nvidia|ai|deepmind|claude|anthropic|openai|chip/.test(lc)) return "tech";
    if (/reddit/.test(lc)) return "reddit";
    return "art";
  };
  function displayTitle(a) {
    if (a.title) return esc(a.title.slice(0, 100));
    return esc(a.slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80));
  }
  let items = "";
  all.forEach((a, i) => {
    const title = displayTitle(a);
    const date = a.date ? new Date(a.date).toLocaleDateString("pl-PL") : "";
    const articleUrl = `${BASE}/articles/${a.slug}.html`;
    const tCls = a.source && a.source.startsWith("http") ? tagClass(a.source) : tagClass(a.slug);
    const tLbl = a.source && a.source.startsWith("http") ? tagLabel(a.source) : tagLabel(a.slug);
    items += `
      <div class="feed-line">
        <span class="feed-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="feed-tag ${tCls}">${tLbl}</span>
        <span class="feed-date">${date}</span>
        <span class="feed-title"><a href="${articleUrl}">${title}</a></span>
        <a class="feed-link" href="${articleUrl}">[read]</a>
      </div>`;
  });

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KROKIET NEWS — Archiwum</title>
<meta name="description" content="Terminal news feed — automatycznie generowane artykuły AI z branży e-commerce, dropshippingu, AI i technologii.">
<meta property="og:title" content="KROKIET NEWS — Archiwum">
<meta property="og:description" content="Terminal news feed">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE}/articles/">
<meta name="twitter:card" content="summary">
<style>${TERMINAL_CSS}</style>
</head>
<body>
<header class="term-header">//====[ KROKIET NEWS ]====\\\\</header>
${TERM_NAV}
<div class="term-wrap">
<div class="hero-panel">
<h1 class="glitch" data-text="KROKIET NEWS">KROKIET NEWS</h1>
<div class="sub">terminal news feed &mdash; AI-generated</div>
</div>
<div class="count-line">&gt; ${all.length} sygnałów w archiwum</div>
${items || '<div class="empty-line">&gt; brak sygnałów. nasłuch trwa...</div>'}
</div>
<footer class="term-footer">[STATUS] NET-LINK ACTIVE &mdash; <a href="${BASE}/articles/sitemap.xml">sitemap</a> &middot; <a href="${BASE}/articles/feed.xml">rss</a> &mdash; KROKIET NEWS</footer>
</body>
</html>`;
  writeFileSync("articles/index.html", html, "utf8");
  return all.length;
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
  <url><loc>${BASE}/articles/</loc><lastmod>${new Date().toISOString().slice(0,10)}</lastmod><priority>0.9</priority></url>
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
    <link>${BASE}/articles/</link>
    <description>Automatycznie generowane artykuły SEO z RSS feedów. B2B dropshipping, e-commerce, AI.</description>
    <language>pl</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${BASE}/articles/feed.xml" rel="self" type="application/rss+xml"/>
${items}  </channel>
</rss>`;
  writeFileSync("articles/feed.xml", xml, "utf8");
  return all.length;
}

export const TERMINAL_CSS = `
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
@media(max-width:600px){h1{font-size:1.2rem}.meta-line{font-size:.7rem;gap:.6rem}.feed-line{font-size:.78rem}.term-header,.term-footer{font-size:.7rem}}
@media print{body::before{display:none}body{color:#000;background:#fff}}
`;

// ── NB Notebook UUIDs (single source of truth) ──
export const NB_NEWS_ID = "5dd3bcd8-fc51-481e-bffa-fab231a378c3";
export const NB_SOURCES_ID = "9ebb1726-9322-423e-92f4-b081d65218b5";
export const NB_RESEARCH_ID = "7a31df6c-2516-4a0a-a0a6-34403d15f10a";
export const NB_AUDIO_ID = "992ecd72-3d82-4232-82e0-b5ecbd0a7755";
