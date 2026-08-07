import { readFileSync, readdirSync } from "fs";
import { pushArticleToFirebase } from "./lib/shared.mjs";

const files = readdirSync("articles").filter(f => f.endsWith(".html") && f !== "index.html");
console.log(`Migruję ${files.length} artykułów do Firebase...\n`);

let ok = 0, fail = 0;
for (const f of files) {
  const slug = f.replace(".html", "");
  const html = readFileSync(`articles/${slug}.html`, "utf8");

  const titleM = html.match(/<title>([^<]+)/);
  const title = titleM ? titleM[1].replace(/ — KROKIET NEWS$/, "") : slug;
  const bodyM = html.match(/<article>([\s\S]*?)<\/article>/);
  const bodyHtml = bodyM ? bodyM[1] : "<p></p>";
  const url = `https://pkrokosz.github.io/smartbuyers/articles/${slug}.html`;
  const sourceM = html.match(/source:\s*<a href="([^"]+)"/);
  const sourceUrl = sourceM ? sourceM[1] : null;

  try {
    await pushArticleToFirebase(slug, title, bodyHtml, url, sourceUrl);
    console.log(`  ✅ ${slug.slice(0, 60)}`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${slug.slice(0, 60)}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${ok} OK, ${fail} fail`);
