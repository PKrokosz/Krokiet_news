# SmartBuyers — Direction & Roadmap

## Stan obecny

Mamy pipeline: **RSS → NVIDIA NIM → HTML → GitHub Pages** z podstawową telemetrią, deduplikacją (`generated.json`) i jednym punktem startowym (`menu.mjs`).

**Co działa:** streaming tokenów, `response_format: json_object`, walidacja + retry, connectivity check, auto git push, Task Scheduler co 30min.

**Co nie działa:** 500 linii kodu skopiowanych między `generate.mjs` a `rss-watch.mjs`. Każda zmiana wymaga edycji w dwóch plikach. Model `qwen2.5:latest` produkuje ~200 słów słabej polszczyzny w ~220s.

---

## Kluczowa akcja: wspólny moduł `lib/shared.mjs`

**Jeden plik, ~250 linii, który znosi 500 linii duplikacji.** Obie apki importują z niego:

```
lib/shared.mjs:
  C (kolory), esc(), ts(), step()
  loadGen/saveGen/isGen/markGen (generated.json)
  S_RSS, S_TOPIC (system prompty)
  promptRss(), promptTopic() (user prompty)
  validate() (walidacja)
  streamResponse() (streaming SSE)
  buildHtml() (szablon HTML)
  slugify() (slug z tytułu)
  gitPush() (git add/commit/push)
  providerStatus() (NVIDIA API connectivity check)
```

**Dlaczego to jest fundament wszystkiego dalej:** każde nowe rozszerzenie (format, persona, ton, SEO schema) dodaje się **raz** w `lib/shared.mjs` i oba skrypty dziedziczą automatycznie.

---

## Faza 1: Fundament SEO (1 dzień, maksymalny efekt)

### 1.1 Schema.org Article markup — JSON-LD

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tytuł artykułu",
  "description": "Meta description",
  "datePublished": "2026-06-24",
  "author": { "@type": "Organization", "name": "SmartBuyers" },
  "publisher": { "@type": "Organization", "name": "SmartBuyers" }
}
</script>
```

**Efekt:** Google rich results (top stories, article carousel). ~15 linii kodu. Najwyższy ROI.

### 1.2 Open Graph + Twitter Card

```html
<meta property="og:title" content="..." />
<meta property="og:description" content="..." />
<meta property="og:type" content="article" />
<meta name="twitter:card" content="summary" />
```

**Efekt:** Podgląd artykułów w social media (Facebook, LinkedIn, Twitter). ~10 linii.

### 1.3 Sitemap generator

Skrypt `sitemap.mjs` → czyta `articles/` + `generated.json` → `sitemap.xml`:

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://pkrokosz.github.io/smartbuyers/articles/slug.html</loc><lastmod>2026-06-24</lastmod></url>
</urlset>
```

**Efekt:** Google indeksuje wszystkie artykuły automatycznie. ~30 linii.

### 1.4 Google Indexing API ping

Po każdym pushu: `POST https://indexing.googleapis.com/v3/urlNotifications:publish` z URL nowego artykułu.

**Efekt:** Google crawler dostaje powiadomienie w ciągu minut, nie dni. ~20 linii + Google API key.

---

## Faza 2: Content diversity ✅ ZREALIZOWANE

### 2.1 `--format` — 8 typów artykułów

| Format | Prompt | Struktura HTML |
|--------|--------|---------------|
| `list` | "Top X [temat] na 2026 rok. Numerowana lista z opisem każdego punktu." | `<ol><li><h3>...</h3><p>...</p></li></ol>` |
| `howto` | "Krok po kroku: jak [osiągnąć cel]. Każdy krok z przykładem." | `<h2>Krok 1: ...</h2><p>...</p><pre><code>...</code></pre>` |
| `explainer` | "Czym jest [temat]? Definicja, mechanizm działania, korzyści, przykłady." | `<h2>Czym jest...</h2><h2>Jak działa...</h2><h2>Korzyści...</h2>` |
| `comparison` | "Porównanie X vs Y. Tabela różnic, wady/zalety, rekomendacja." | `<h2>X</h2><h2>Y</h2><h2>Porównanie</h2><table>...</table>` |
| `myth-fact` | "5 mitów o [temat]. Mit → Fakt z wyjaśnieniem." | `<blockquote>Mit: ...</blockquote><p><strong>Fakt:</strong> ...</p>` |
| `faq` | "Najczęstsze pytania o [temat]." | `<h3>Pytanie?</h3><p>Odpowiedź...</p>` |
| `digest` | "Przegląd tygodnia: [temat]. 5 najważniejszych newsów." | `<h2>1. Tytuł</h2><p>...</p><h2>2. Tytuł</h2>...` |
| `opinion` | "Moim zdaniem: [temat]. Argumenty za, przeciw, konkluzja." | Perswazyjny, pierwsza osoba |

### 2.2 `--persona` — 5 stylów pisania

| Persona | Prompt character |
|---------|-----------------|
| `journalist` | Obiektywny, oparty na faktach, cytuje źródła (domyślny) |
| `marketer` | Perswazyjny, benefit-oriented, z CTA na końcu |
| `technical` | Precyzyjny, definiuje terminy, pokazuje kod/dane |
| `ceo` | Strategiczny, big-picture, "co to oznacza dla branży" |
| `customer` | Praktyczny, first-person, "jak ja to rozwiązałem" |

### 2.3 `--tone` — 4 rejestry

| Tone | Modyfikator prompta |
|------|-------------------|
| `casual` | "Pisz jakbyś rozmawiał z kolegą przy kawie" |
| `formal` | "Profesjonalny, biznesowy ton" |
| `educational` | "Wyjaśniaj każdy termin, podawaj przykłady" |
| `urgent` | "Dlaczego to WAŻNE TERAZ. Poczucie pilności." |

### 2.4 `--lang` — języki wyjściowe

| Lang | Prompt |
|------|--------|
| `pl` | "Po polsku" (domyślny) |
| `en` | "In English" |
| `de` | "Auf Deutsch" |

---

## Faza 3: RSS intelligence ✅ ZREALIZOWANE

### 3.1 Nowe feedy w `feeds.json`

```json
[
  { "name": "TechCrunch AI", "url": "https://techcrunch.com/category/ai/feed/", "filter": null },
  { "name": "Google News dropshipping PL", "url": "https://news.google.com/rss/search?q=dropshipping+polska&hl=pl&gl=PL&ceid=PL:pl", "filter": null },
  { "name": "Google News e-commerce EN", "url": "https://news.google.com/rss/search?q=e-commerce+trends+2026&hl=en&gl=US&ceid=US:en", "filter": null },
  { "name": "Reddit r/dropshipping", "url": "https://www.reddit.com/r/dropshipping/.rss", "filter": null },
  { "name": "Reddit r/ecommerce", "url": "https://www.reddit.com/r/ecommerce/.rss", "filter": null },
  { "name": "Hacker News", "url": "https://hnrss.org/frontpage", "filter": ["ai", "startup", "saas", "ecommerce"] }
]
```

### 3.2 `--filter` — filtrowanie po słowach kluczowych

Nie każdy news z feedu jest relevant. Dodajemy `"filter": ["ai", "ecommerce"]` — jeśli tytuł nie zawiera żadnego słowa, pomijamy.

### 3.3 AlphaSignal, Amazon RSS, Google Scholar

| Źródło | URL | Content |
|--------|-----|---------|
| AlphaSignal | Newsletter → bridge RSS | AI/ML research digest |
| Amazon Best Sellers | `amazon.com/best-sellers/zgbs/rss` | Product trend intel |
| Google Scholar alert | Manual RSS per query | Academic papers → blog |
| YouTube channel | `youtube.com/feeds/videos.xml?channel_id=X` | Video → article |
| ProductHunt | `producthunt.com/feed` | Nowe narzędzia dla e-commerce |

### 3.4 Digest mode — wiele newsów → jeden artykuł

Zamiast 1 news = 1 artykuł, zbierz 5 newsów z feedu → jeden "Przegląd tygodnia: AI w e-commerce". Większa wartość, mniej generowań.

---

## Faza 4: Content intelligence ✅ ZREALIZOWANE

### 4.1 Internal linking

Po zapisie artykułu: przeskanuj `articles/` i znajdź inne artykuły, których slug pojawia się w body. Auto-dodaj `<a href="/articles/inny.html">` linki. Brak linków wewnętrznych to #1 problem SEO.

### 4.2 FAQ Schema — structured data

Gdy `--format faq`: generuj dodatkowe `application/ld+json` z `@type: FAQPage` + `mainEntity: [{@type: Question, name, acceptedAnswer: {text}}]`. Google wyświetla FAQ rich results.

### 4.3 Content gap analyzer

`node analyze.mjs` → czyta wszystkie `generated.json` + `articles/` → grupuje keywords → identyfikuje brakujące tematy → output: `gaps.json` z sugerowanymi tematami.

### 4.4 Competitor RSS intelligence

Dodaj feedy konkurencji do `feeds.json` z `"mode": "track"` (nie generuj, tylko loguj). `competitors.json` → co publikują, jak często, jakie keywords.

### 4.5 Readability scoring

Policz FOG index dla każdego wygenerowanego artykułu. Jeśli poza targetem (60-70 dla B2B), retry z inną temperaturą.

---

## Faza 5: Dystrybucja ✅ ZREALIZOWANE

### 5.1 RSS feed bloga

Generuj `feed.xml` z `generated.json`. Subskrybenci dostają nowe artykuły automatycznie.

### 5.2 Social media auto-post

Po każdym nowym artykule: POST do Facebook API (grupy SelleeTools), LinkedIn API.

### 5.3 Newsletter digest

Co tydzień: zbierz 5 najlepszych artykułów z tygodnia → wygeneruj email HTML → wyślij przez Mailchimp API.

---

## Priorytetyzacja

| # | Co | Wysiłek | Wpływ | Blokuje |
|---|----|---------|-------|---------|
| 1 | `lib/shared.mjs` — wspólny moduł | 2h | Fundament | Wszystko dalej |
| 2 | Schema.org + Open Graph w HTML | 0.5h | Bardzo wysoki | — |
| 3 | `--format` flag (8 typów) | 3h | Wysoki | — |
| 4 | `--persona` + `--tone` | 1.5h | Średni | — |
| 5 | Sitemap + Google Indexing ping | 1h | Wysoki | — |
| 6 | Nowe RSS feedy w feeds.json | 0.5h | Wysoki | — |
| 7 | `--filter` słowa kluczowe per feed | 0.5h | Średni | — |
| 8 | Digest mode (wiele → jeden) | 2h | Wysoki | — |
| 9 | Internal linking | 4h | Bardzo wysoki | — |
| 10 | FAQ Schema | 2h | Średni | Faza 4 |
| 11 | Content gap analyzer | 4h | Wysoki | Faza 4 |
| 12 | Social media auto-post | 6h | Średni | Faza 5 |

---

## Diagram przepływu docelowego

```
menu.mjs (punkt startu)
  │
  ├─ 1. Generuj z tematu   → generate.mjs [--format X] [--persona Y] [--tone Z]
  ├─ 2. Generuj z RSS      → generate.mjs --rss URL [--format X] [--push]
  ├─ 3. Auto-watch RSS     → rss-watch.mjs (Task Scheduler co 30min)
  └─ 4. Review RSS         → rss-watch.mjs --review
        │
        ├─ fetch RSS (z filtrem słów kluczowych)
        ├─ sprawdź generated.json
        ├─ warmup + generate (streaming, JSON mode, walidacja, retry)
        ├─ build HTML (schema.org, OG meta, internal links, source link)
        ├─ save articles/slug.html
        ├─ update generated.json
        ├─ update sitemap.xml
        ├─ git push
        └─ Google Indexing API ping

narzędzia pomocnicze:
  analyze.mjs     — content gap, competitor tracking, keyword clustering
  sitemap.mjs     — regeneracja sitemap.xml
  competitors.mjs — feedy konkurencji w trybie "track"

---
**Status: 100% zrealizowany — 5/5 faz + ponytail cleanup ✓**

```
