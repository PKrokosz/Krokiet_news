import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { loadGen, C, NB_SOURCES_ID, NB_RESEARCH_ID } from "./lib/shared.mjs";

function nbCli(...args) {
  const nbPy = fileURLToPath(new URL("./engines/nb_runner.py", import.meta.url));
  try {
    const out = execSync(`python "${nbPy}" ${args.map(a => `"${String(a).replace(/"/g,'\\"')}"`).join(" ")}`, { encoding:"utf8", timeout:300000 });
    return JSON.parse(out.trim());
  } catch (e) { return { error: e.message }; }
}

async function main() {
  console.log(`${C.cyn}╔══════════════════════════════════════════╗${C.rst}`);
  console.log(`${C.cyn}║     Content Intelligence Analyzer (NB)    ║${C.rst}`);
  console.log(`${C.cyn}╚══════════════════════════════════════════╝${C.rst}\n`);

  const gen = loadGen();
  const entries = Object.entries(gen);
  console.log(`  ${C.grn}→ ${entries.length} artykułów w generated.json\n`);

  // ── NB Source Guide: keywords from sources ──
  console.log("\n  ── NotebookLM Keywords (source guide) ──");
  const src = nbCli("sources", NB_SOURCES_ID);
  const sources = src.sources || [];
  let topKeywords = [];
  if (sources.length > 0) {
    for (const s of sources.slice(0, 5)) {
      const guide = nbCli("source-guide", NB_SOURCES_ID, s.id);
      if (!guide.error && guide.keywords) {
        topKeywords.push(...(Array.isArray(guide.keywords) ? guide.keywords : [guide.keywords]));
      } else if (!guide.error) {
        const kw = guide.text || guide.output || JSON.stringify(guide).slice(0, 200);
        topKeywords.push(kw);
      }
    }
  } else {
    console.log(`    ${C.dim}brak źródeł — uruchom rss-watch${C.rst}`);
  }
  const uniqueKws = [...new Set(topKeywords)].slice(0, 20);

  // ── NB Research: gaps from deep research ──
  console.log("  ── NotebookLM Deep Research ──");
  const topics = entries.slice(0, 3).map(([, info]) => info.slug?.replace(/-/g, " "));
  let gapCount = 0;
  for (const topic of topics) {
    console.log(`    ${C.ylw}→ Research: "${topic?.slice(0, 60)}"${C.rst}`);
    const r = nbCli("add-research", NB_RESEARCH_ID, topic, "--mode", "deep");
    if (r.error) console.log(`      ${C.dim}skip: ${r.error.slice(0, 60)}${C.rst}`);
    else { console.log(`      ${C.grn}OK${C.rst}`); gapCount++; }
  }

  // ── Local stats (backward compat) ──
  console.log("\n  ── Statystyki lokalne ──");
  const articleDates = entries.map(([, info]) => info.date).filter(Boolean).sort();
  console.log(`    Artykułów: ${entries.length}`);
  console.log(`    Ostatni: ${articleDates[articleDates.length - 1] || "brak"}`);
  console.log(`    Najstarszy: ${articleDates[0] || "brak"}`);

  // ── Competitors ──
  console.log("\n  ── Konkurencja (competitors.json) ──");
  let compItems = [];
  if (existsSync("competitors.json")) {
    try { compItems = JSON.parse(readFileSync("competitors.json", "utf8")); } catch {}
  }
  if (compItems.length === 0) {
    console.log(`    ${C.dim}brak danych${C.rst}`);
  } else {
    const byFeed = new Map();
    for (const ci of compItems) {
      const f = ci.feedName || "unknown";
      if (!byFeed.has(f)) byFeed.set(f, []);
      byFeed.get(f).push(ci);
    }
    byFeed.forEach((items, feed) => console.log(`    ${C.grn}${feed}${C.rst} — ${items.length} wpisów`));
  }

  const report = {
    date: new Date().toISOString(),
    articleCount: entries.length,
    topKeywords: uniqueKws.map(k => ({ keyword: String(k).slice(0,60) })),
    gapCount: gapCount,
    competitors: compItems.length,
    nbSources: sources.length,
  };
  writeFileSync("gap-report.json", JSON.stringify(report, null, 2));
  console.log(`\n  ${C.dim}→ gap-report.json zapisany${C.rst}\n`);
}

main();
