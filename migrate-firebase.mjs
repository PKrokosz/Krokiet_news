import { readFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { pushArticleToFirebase, loadGen } from "./lib/shared.mjs";

const files = readdirSync("articles").filter(f => f.endsWith(".html") && f !== "index.html");
console.log(`MigrujÄ™ ${files.length} artykuĹ‚Ăłw do Firebase...\n`);

const gen = loadGen();
const genDates = new Map();
for (const [, info] of Object.entries(gen)) {
  if (info.slug && info.date && !genDates.has(info.slug)) genDates.set(info.slug, info.date);
}

function getDate(slug) {
  const iso = genDates.get(slug);
  if (iso) return new Date(iso).toLocaleDateString("pl-PL");
  try {
    const gd = execSync(`git log --follow --diff-filter=A -1 --format=%aI "articles/${slug}.html"`, { encoding: "utf8", timeout: 3000 }).trim();
    if (gd) return new Date(gd).toLocaleDateString("pl-PL");
  } catch {}
  return null;
}

let ok = 0, fail = 0;
for (const f of files) {
  const slug = f.replace(".html", "");
  const html = readFileSync(`articles/${slug}.html`, "utf8");

  const titleM = html.match(/<title>([^<]+)/);
  const title = titleM ? titleM[1].replace(/ â€” KROKIET NEWS$/, "") : slug;
  const bodyM = html.match(/<article>([\s\S]*?)<\/article>/);
  const bodyHtml = bodyM ? bodyM[1] : "<p></p>";
  const url = `https://pkrokosz.pl/news/articles/${slug}.html`;
  const sourceM = html.match(/source:\s*<a href="([^"]+)"/);
  const sourceUrl = sourceM ? sourceM[1] : null;
  const date = getDate(slug);

  try {
    await pushArticleToFirebase(slug, title, bodyHtml, url, sourceUrl, date);
    console.log(`  âś… ${slug.slice(0, 55)}  |  ${date}`);
    ok++;
  } catch (e) {
    console.log(`  âťŚ ${slug.slice(0, 55)}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${ok} OK, ${fail} fail`);
