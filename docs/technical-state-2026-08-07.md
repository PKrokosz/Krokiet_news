# KROKIET NEWS — Dokumentacja techniczna (stan na 7.08.2026)

## Domena
https://pkrokosz.pl (GitHub Pages + domena na seohost, DNS: 4× A + CNAME www)

## Architektura

```
generate.mjs / rss-watch.mjs (generowanie)
    ├─ NVIDIA API → JSON article
    ├─ buildHtml() → articles/<slug>.html (lokalnie)
    ├─ pushArticleToFirebase() → Firebase Realtime DB (index/<slug>)
    └─ generateIndex() → index.html (szablon, rzadko zmieniany)

index.html (statyczny szablon na GitHub Pages)
    └─ boot → fetch(FB/index/.json) → ARTICLES[] → renderMenu→renderRows

Firebase (Realtime DB, Spark tier — darmowy)
    krokiet_news/
      home: <int>                          # licznik wizyt głównej
      articles/<slug>: <int>               # licznik per-artykuł
      index/<slug>: {t,d,g,b,u}            # meta + sekcje body
```

Artykuły HTML NIE są pushowane na GitHub Pages (tylko SEO: sitemap.xml + feed.xml). Treść ładuje się z Firebase inline.

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `lib/shared.mjs` | BASE, buildHtml, buildPrompt, generateIndex, gitPush, Firebase helpers |
| `generate.mjs` | CLI generowania (dashboard + ręczne) |
| `rss-watch.mjs` | Auto-generowanie z 6 feedów RSS + digest |
| `menu-server/server.mjs` | Dashboard API (port 3000) |
| `menu-server/public/app.js` | Dashboard frontend |
| `index.html` | Szablon strony głównej (regenerowany przez generateIndex) |
| `migrate-firebase.mjs` | Migracja / sync artykułów do Firebase |
| `newsletter.mjs` | Newsletter HTML |
| `rebuild.mjs` | Rebuild wszystkich artykułów (nie używać — resetuje daty!) |

## Firebase — helpery (shared.mjs)

```js
FB = "https://krokiet-news-default-rtdb.europe-west1.firebasedatabase.app/krokiet_news"
fbInc(path)              // inkrementuje counter
fbArticlePush(slug,t,d,g,b,u)  // push metadanych
pushArticleToFirebase(slug, title, bodyHtml, url, sourceUrl, optDate)
```

## Format sekcji w Firebase

```json
{
  "t": "Tytuł artykułu",
  "d": "7.08.2026",
  "g": "TECH",
  "b": [["nagłówek h2/h3", "tekst sekcji"], ...],
  "u": "https://pkrokosz.pl/articles/slug.html"
}
```

## Znane problemy

1. **`buildHtml()` resetuje `datePublished`** na `new Date()` — nie regenerować starych artykułów bez fixu
2. **Dashboard SSE** — moduł cache Node.js (dynamic import) → restart serwera po zmianach shared.mjs
3. **List format** — sekcje używają `<h3>`, regex `h[23]` obsługuje oba (fix z sesji)
4. **Mobile** — pasek boczny zwinięty domyślnie (<600px), `setRail(open, force)`
5. **Dashboard push:false** dla kolejki — artykuły tylko lokalnie + Firebase, nie na GitHub Pages
6. **RSS auto-watch** pushuje tylko `sitemap.xml feed.xml generated.json`

## Tagi — kolory

| TAG | Kolor | Regex |
|---|---|---|
| TECH | cyjan | techcrunch, google, amazon, nvidia, ai, deepmind, claude, anthropic, openai, chip |
| REDDIT | jasnozielony | reddit |
| ART | muted | fallback |

## Dashboard

- URL: `http://localhost:3000`
- Start: `Start-Process powershell -NoExit -Command "...\menu-server\server.mjs"`
- API: `GET /api/status`, `POST /api/run/:action`, `POST /api/push`
- `/api/push` → git commit+push `articles/ generated.json`

## Komendy

```bash
# Generowanie z RSS (auto)
node rss-watch.mjs --push

# Generowanie ręczne
node generate.mjs "Temat" --url "https://..." --non-interactive --json-output

# Migracja do Firebase
node migrate-firebase.mjs

# Regeneracja index.html
node -e "import('./lib/shared.mjs').then(m=>m.generateIndex())"
```
