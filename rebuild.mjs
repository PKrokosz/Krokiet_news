import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { C, loadGen, buildHtml, generateIndex, generateSitemap, generateFeed } from "./lib/shared.mjs";

const gen = loadGen();
const entries = Object.entries(gen);
const seen = new Set(Object.values(gen).map(x => x.slug));

function rebuildFile(slug, url = null) {
  const fname = `articles/${slug}.html`;
  if (!existsSync(fname)) return null;

  const raw = readFileSync(fname, "utf8");
  const bodyM = raw.match(/<article>([\s\S]*?)<\/article>/);
  if (!bodyM) return null;

  const titleM = raw.match(/<title>([^<]+)<\/title>/);
  const descM = raw.match(/<meta name="description" content="([^"]+)"/);
  const kwM = raw.match(/<meta name="keywords" content="([^"]+)"/);
  const modelM = raw.match(/(?:model|\\[)\s*([\w.\/-]{3,60})/);
  const sourceM = raw.match(/(?:source|r.d.o):\s*<a href="([^"]+)">([^<]*)<\/a>/);

  const title = titleM ? titleM[1].replace(/ \u2014 (SmartBuyers|KROKIET NEWS)$/, "").trim() : slug;
  const desc = descM ? descM[1] : "";
  const keywords = kwM ? kwM[1] : "";
  const body = bodyM[1];
  const model = modelM ? modelM[1] : "unknown";
  const sourceLink = sourceM ? sourceM[1] : (url || "");
  const sourceLabel = sourceM && sourceM[2] ? sourceM[2] : (url || "");

  const data = { title, desc, keywords, body };
  const result = buildHtml(data, body, title, model, {
    sourceLink: sourceLink.startsWith("http") ? sourceLink : url || "",
    sourceLabel,
  });

  writeFileSync(fname, result.html, "utf8");
  return slug;
}

let rebuilt = 0;
let skipped = 0;

// entries from generated.json
for (const [url, info] of entries) {
  const ok = rebuildFile(info.slug, url);
  if (ok) { console.log(`  ${C.grn}OK${C.rst} ${ok}`); rebuilt++; }
  else { console.log(`  ${C.red}SKIP${C.rst} ${info.slug}`); skipped++; }
}

// scan directory for files not in generated.json
try {
  const files = readdirSync("articles").filter(f => f.endsWith(".html") && f !== "index.html");
  for (const f of files) {
    const slug = f.replace(".html", "");
    if (seen.has(slug)) continue;
    const ok = rebuildFile(slug);
    if (ok) { console.log(`  ${C.cyn}OK${C.rst} ${ok} (orphan)`); rebuilt++; }
    else { console.log(`  ${C.dim}SKIP${C.rst} ${slug}`); skipped++; }
  }
} catch (e) { console.log(`  ${C.ylw}skan: ${e.message}${C.rst}`); }

generateIndex();
generateSitemap();
generateFeed();

console.log(`\n${C.grn}Gotowe: ${rebuilt} przebudowanych, ${skipped} pominiętych${C.rst}`);
