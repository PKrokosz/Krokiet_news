# KROKIET NEWS Article Wizard — Plan Wdrożenia

## 1. Streszczenie

Nowy kreator artykułu (`wizard.mjs`) zastępuje chaos `menu.mjs` → `generate.mjs` / `rss-watch.mjs` jednym, spójnym flowem typu wizard-step, w którym użytkownik na każdym etapie wybiera z dostępnych opcji. Wizard **orkiestruje** istniejące narzędzia i dane, ale nie duplikuje ich logiki.

**Cel:** user nie musi pamiętać flag CLI, nazw formatów, kluczy person. Wybiera z wizualnego menu, widzi podsumowanie, klika "generuj".

### 1.1 Nowa architektura: Web Tile UI

Nowa wersja na gicie (`1c93b1d`) wprowadza pełne webowe Tile UI w `menu-server/`. To zmienia medium wizarda z CLI na przeglądarkę:

| Aspekt | Stara koncepcja (CLI) | Nowa koncepcja (Web) |
|---|---|---|
| Entry point | `npm run wizard` → `wizard.mjs` | Tile "✦ Nowy Artykuł" na dashboardzie |
| Środowisko | Node.js `readline` + ANSI | HTML/CSS/JS w przeglądarce |
| Kroki | ASCII boxy w terminalu | Dialogi modalne / sekwencyjne screeny |
| Tipy | Dim tekst + `?` klawisz | Subtelne tooltipy hover + przyciski `?` |
| Generowanie | `spawn("node", ...)` | `POST /api/run/generate` + SSE streaming |
| Źródła RSS | `rss-parser` w Node | `GET /api/rss/parse?url=...` |
| NB | `execSync` Pythona | `POST /api/nb/*` (REST API) |
| Bazę danych | Supabase (koncept) | `topic-queue.json` + `research-sources.json` (już istnieje) |

Nowe pliki do utworzenia (add-ons do istniejącego Tile UI):

| Plik | Opis |
|---|---|
| `menu-server/public/wizard.css` | Style kreatora (kroki, progress bar, dialog, tooltipy) |
| `menu-server/public/wizard.js` | Logika kreatora — 8 kroków jako komponenty renderowane w `#tiles` lub w dedykowanym dialogu |

Pliki do minimalnej zmiany:

| Plik | Zmiana |
|---|---|
| `menu-server/public/app.js` | Dodać tile "✦ Nowy Artykuł" na dashboardzie + routing do `wizard` level |
| `lib/shared.mjs` | Bez zmian (wizard jako web UI nie potrzebuje Node.js importów — korzysta z REST API) |

---

---

## 2. Zasady nieinwazyjne

Wizard jest **wyłącznie addytywny** — nie modyfikuje logiki istniejących funkcji. Jedyna zmiana w innych plikach to ekspozycja istniejących helperów i dodanie jednego guzika.

### 2.1 Co wolno zmienić

| Plik | Zmiana | Powód |
|---|---|---|
| `menu-server/public/app.js` | Dodać tile "✦ Nowy Artykuł" na dashboardzie + routing do widoku wizarda | Entry point do kreatora |
| `menu-server/public/wizard.js` | **NOWY** — logika kreatora (~500 linii), 8 kroków renderowanych w głównym panelu | Główny komponent wizarda |
| `menu-server/public/wizard.css` | **NOWY** — style: progress bar, kroki, tooltipy, dialog potwierdzenia | Warstwa wizualna |
| `lib/shared.mjs` | Bez zmian | Wizard komunikuje się przez REST API, nie przez Node.js importy |
| `package.json` | Bez zmian | Wizard uruchamia się w przeglądarce, nie jako osobny skrypt |

### 2.2 Czego NIE wolno zmieniać

| Plik | Dlaczego |
|---|---|
| `generate.mjs` | Samodzielny tryb ręczny — działa niezależnie |
| `rss-watch.mjs` | Auto-pipeline — działa niezależnie |
| `social.mjs` | LinkedIn — importer, nie modyfikowany |
| `newsletter.mjs` | Newsletter — importer, nie modyfikowany |
| `analyze.mjs` | Analiza — importer, nie modyfikowany |
| `debug_rss.mjs` | Debug — narzędzie pomocnicze |
| Wszystkie HTML/CSS w `articles/`, `blog/`, `index.html` | Warstwa prezentacji — nietknięta |
| `_includes/`, `_layouts/`, `_config.yml` | Legacy Jekyll — już ignorowane |

### 2.3 Zależności wizarda

```javascript
// wizard.js — korzysta wyłącznie z REST API menu-servera (port 3000)

// Źródła danych:
const feeds    = await fetch('/api/feeds').then(r => r.json());
const queries  = await fetch('/api/queries').then(r => r.json());
const rssItems = await fetch('/api/rss/parse?url=' + feedUrl).then(r => r.json());
const topics   = await fetch('/api/topics').then(r => r.json());

// NotebookLM:
const sources  = await fetch('/api/nb/notebooks/' + nbId + '/sources').then(r => r.json());
const research = await fetch('/api/research-sources').then(r => r.json());

// Ustawienia:
const settings = await fetch('/api/settings').then(r => r.json());
const models   = await fetch('/api/models').then(r => r.json());

// Generowanie (SSE streaming):
const run = await fetch('/api/run/generate', { method:'POST', body: JSON.stringify({ topic, format, ... }) });
const stream = new EventSource('/api/run/' + run.runId + '/stream');
```

Wizard **nie duplikuje** logiki — każda funkcja z `lib/shared.mjs` (`buildPrompt`, `buildHtml`, `markGen`, `generateIndex`...) jest wołana przez serwer (`server.mjs` → `spawn("node", ["generate.mjs", ...])`), nie przez frontend.

---

## 3. Entry point: tile "✦ Nowy Artykuł" w dashboardzie

Na głównej stronie Tile UI (`http://localhost:3000`), w sekcji "Generowanie treści", widoczny wyróżniony tile:

```
┌─────────────────────────────────┐
│  ✦                              │
│  NOWY ARTYKUŁ                    │
│  ─────────────────────────────  │
│  Kreator krok po kroku          │
│  Wybierz źródło → temat →       │
│  format → generuj.              │
│  Jeden przycisk, 8 prostych     │
│  kroków.                        │
│                                  │
│  [Rozpocznij kreator →]         │
└─────────────────────────────────┘
```

**Zachowanie:**
- Kliknięcie → przechodzi do widoku `wizard` (w istniejącym systemie nawigacji `pushLevel`)
- Tile na stałe na dashboardzie, zawsze widoczny
- Animowany border (pulsujący accent `#159957`), delikatny gradient tła
- Po lewej stronie sidebar — statystyki: "13 artykułów · 6 feedów · 2 modele"

**Implementacja w `app.js` (dodatek ~30 linii):**
```javascript
// W definicji LEVEL_META dodać:
wizard: { title: 'Nowy Artykuł', sub: 'Kreator krok po kroku' },

// W funkcji renderującej dashboard tiles:
tile('wizard', '✦', 'Nowy Artykuł',
  'Kreator krok po kroku — wybierz źródło, temat, format i generuj.',
  'Rozpocznij kreator →',
  { class: 'wizard-tile-primary' }
);
```

---

## 4. Pełny flow UX (8 kroków)

### Legenda

- `[x]` — selected option
- `[ ]` — unselected
- `←` — default
- `[===]` input field
- Puste `[Enter]` = akceptuj domyślny

---

### KROK 1/8 — Wybór źródła danych

```
╔══════════════════════════════════════════════════════╗
║     KROKIET NEWS Wizard — Krok 1/8: Źródło danych    ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Skąd wziąć temat artykułu?                          ║
║                                                      ║
║  [1] Feed RSS (zapisane w feeds.json)                ║
║      → 6 feedów: TechCrunch AI, Google News x2,      ║
║        Reddit x2, Hacker News                        ║
║                                                      ║
║  [2] Google News (dynamiczne zapytania)               ║
║      → 67 zapytań w 5 kategoriach + własne            ║
║                                                      ║
║  [3] Własny temat (wpisuję ręcznie)                  ║
║      → dowolny prompt, opcjonalnie URL źródłowy       ║
║                                                      ║
║  [4] NotebookLM (źródła z notatnika)                  ║
║      → przeglądaj źródła Notatnika, użyj jako prompt  ║
║                                                      ║
║  [5] Baza danych / historia / drafty                  ║
║      → zapisane konfiguracje, szablony, kolejka       ║
║      [wymaga Supabase — obecnie nieaktywne]           ║
║                                                      ║
║  [q] Wyjście                                         ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

**Sub-flow 1A: Feed RSS**
```
╔══════════════════════════════════════════════════════╗
║     Wybierz feed RSS:                               ║
║                                                      ║
║  Status: ● nowe  △ sprawdzone  ○ nieaktywne          ║
║                                                      ║
║  [1] ● TechCrunch AI                                 ║
║      → 5 nowych od ostatniego sprawdzenia             ║
║      → Ostatni: 25.06.2026                           ║
║                                                      ║
║  [2] △ Google News: dropshipping PL                  ║
║      → 0 nowych / Pierwszy GUID ustawiony             ║
║                                                      ║
║  [3] △ Google News: e-commerce EN                    ║
║      → 0 nowych / Pierwszy GUID ustawiony             ║
║                                                      ║
║  [4] ○ Reddit r/dropshipping                         ║
║      → Pierwszy GUID ustawiony                       ║
║                                                      ║
║  [5] ○ Reddit r/ecommerce                            ║
║      → NIGDY NIE URUCHOMIONY (lastGuid: null)         ║
║      → [Enter] = ustaw GUID i pomiń | [g] = generuj  ║
║                                                      ║
║  [6] △ Hacker News (filtr: ai, startup...)           ║
║      → 0 nowych / słowa pasujących: ?                 ║
║                                                      ║
║  [+] Dodaj nowy feed                                 ║
║  [b] Wstecz                                          ║
║                                                      ║
║  Wybierz (1-6):                                      ║
╚══════════════════════════════════════════════════════╝
```

**Sub-flow 1B: Google News**
```
╔══════════════════════════════════════════════════════╗
║     Wybierz kategorię zapytań Google News:           ║
║                                                      ║
║  [1] Dropshipping (3 zapytania)                      ║
║      → dropshipping trends 2026, suppliers...        ║
║                                                      ║
║  [2] E-commerce ogólne (12 zapytań)                  ║
║      → trends, AI tools, Shopify, Amazon...          ║
║                                                      ║
║  [3] AI / narzędzia (5 zapytań)                      ║
║      → customer service, copywriting, pricing...     ║
║                                                      ║
║  [4] Marketing / social (5 zapytań)                  ║
║      → TikTok shop, social commerce, live shopping   ║
║                                                      ║
║  [5] Polski rynek (6 zapytań)                        ║
║      → dropshipping Polska, e-commerce trendy PL...  ║
║                                                      ║
║  [6] Niszowe (5 zapytań)                             ║
║      → headless commerce, green e-commerce...        ║
║                                                      ║
║  [7] Wpisz własne zapytanie                          ║
║      → np. "quantum computing e-commerce"            ║
║                                                      ║
║  [b] Wstecz                                          ║
║                                                      ║
║  Wybierz (1-7):                                      ║
╚══════════════════════════════════════════════════════╝
```

Po wyborze kategorii → pokaż konkretne zapytania w kategorii:
```
╔══════════════════════════════════════════════════════╗
║     Zapytania w kategorii "Dropshipping":            ║
║                                                      ║
║  [1] dropshipping trends 2026                        ║
║  [2] dropshipping suppliers                          ║
║  [3] dropshipping automation                         ║
║                                                      ║
║  Wybierz (1-3):                                      ║
╚══════════════════════════════════════════════════════╝
```

**Sub-flow 1D: NotebookLM**
```
╔══════════════════════════════════════════════════════╗
║     Źródła NotebookLM — wybierz źródło jako kontekst:║
║                                                      ║
║  Notatnik: Sources (ID: 9ebb1726...)                 ║
║                                                      ║
║  [1] https://techcrunch.com/.../article-1            ║
║      → "Title: AI chips war 2026"                    ║
║  [2] https://techcrunch.com/.../article-2            ║
║      → "Title: Nvidia water cooling..."              ║
║  ...                                                 ║
║                                                      ║
║  Status: sprawdzanie...                              ║
║                                                      ║
║  [r] Odśwież listę                                   ║
║  [b] Wstecz                                          ║
║                                                      ║
║  Wybierz numer źródła:                               ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 2/8 — Wybór konkretnego tematu

**Dla RSS / Google News:** pokaż listę dostępnych itemów

```
╔══════════════════════════════════════════════════════╗
║     Krok 2/8: Wybierz newsa do przetworzenia         ║
╠══════════════════════════════════════════════════════╣
║  Feed: TechCrunch AI — 5 nowych, 3 już wygenerowane  ║
║                                                      ║
║  [1] ✨ NOWY — 25.06.2026                            ║
║      → "OpenAI unveils custom chip built by Broadcom"║
║      → Treść: OpenAI has unveiled its first...       ║
║         (3421 znaków)                                ║
║      → LINK: techcrunch.com/2026/...                 ║
║                                                      ║
║  [2] ✨ NOWY — 25.06.2026                            ║
║      → "EU pushes back on Washington's chip war"     ║
║      → Treść: The European Union is...               ║
║         (2801 znaków)                                ║
║                                                      ║
║  [3] ✨ NOWY — 24.06.2026                            ║
║      → "Claude Tag learns your company..."           ║
║      → Treść: Anthropic's new feature...             ║
║         (1892 znaków)                                ║
║                                                      ║
║  ─── już wygenerowane (pominięte) ───────────────── ║
║  [~] ✓ Top 4 graczy... (25.06)                       ║
║  [~] ✓ Top 5 zmian... (25.06)                        ║
║  [~] ✓ Digest Technologiczny... (24.06)              ║
║                                                      ║
║  [a] Wybierz wszystkie nowe (multi-generacja)        ║
║  [d] Zbierz wszystkie w digest (jeden artykuł)       ║
║  [f] Filtruj po słowie kluczowym                     ║
║  [b] Wstecz                                          ║
║                                                      ║
║  Wybierz numer (Enter=1), [a], [d]:                  ║
╚══════════════════════════════════════════════════════╝
```

**Dla własnego tematu:**
```
╔══════════════════════════════════════════════════════╗
║     Krok 2/8: Wpisz temat artykułu                   ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Temat: [                                         ]  ║
║         └─ np. "Jak AI zmienia obsługę klienta       ║
║            w dropshippingu B2B"                      ║
║                                                      ║
║  URL źródłowy (opcjonalnie): [                    ]  ║
║         └─ link do oryginalnego źródła, newsa        ║
║                                                      ║
║  Dodatkowy kontekst / instrukcja (opcjonalnie):      ║
║  [                                               ]   ║
║         └─ np. "Skup się na rynku polskim..."        ║
║                                                      ║
║  [Enter] = kontynuuj      [b] = wstecz               ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 3/8 — Format, Persona, Ton, Język

```
╔══════════════════════════════════════════════════════╗
║     Krok 3/8: Format i styl artykułu                 ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  FORMAT (struktura artykułu):                        ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ [A] Standardowy artykuł                   ←  │    ║
║  │     → H2, H3, P, UL — klasyczna struktura    │    ║
║  │                                              │    ║
║  │ [B] Top lista (Top X)                        │    ║
║  │     → <ol><li><h3>punkt</h3><p>opis</p>...   │    ║
║  │                                              │    ║
║  │ [C] Poradnik krok po kroku                   │    ║
║  │     → <h2>Krok 1: ...</h2>...                │    ║
║  │                                              │    ║
║  │ [D] Czym jest X (explainer)                  │    ║
║  │     → definicja → jak działa → korzyści      │    ║
║  │                                              │    ║
║  │ [E] Porównanie X vs Y                        │    ║
║  │     → przegląd X → Y → tabela → werdykt      │    ║
║  │                                              │    ║
║  │ [F] Mit czy fakt (5 mitów)                   │    ║
║  │     → <blockquote>Mit</blockquote> + Fakt      │    ║
║  │                                              │    ║
║  │ [G] FAQ (5+ pytań)                           │    ║
║  │     → <h3>Pytanie</h3><p>Odpowiedź</p>       │    ║
║  │     → + schema.org FAQPage JSON-LD           │    ║
║  │                                              │    ║
║  │ [H] Digest (tylko z wielu źródeł)            │    ║
║  │     → 5 newsów jako <h2> sekcje              │    ║
║  │     → dostępne tylko gdy źródło = multi       │    ║
║  │                                              │    ║
║  │ [I] Opinia / komentarz                       │    ║
║  │     → 1. osoba, argumenty za i przeciw       │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  PERSONA (kto "pisze"?):                             ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ [1] Dziennikarz ←  obiektywny, źródła        │    ║
║  │ [2] Marketer       perswazyjny, CTA          │    ║
║  │ [3] Tech writer    precyzyjny, terminy       │    ║
║  │ [4] CEO/Founder    strategiczny, big-picture │    ║
║  │ [5] Klient/User    praktyczny, 1. osoba      │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  TON:                                                ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ [1] Swobodny ←    jak rozmowa przy kawie     │    ║
║  │ [2] Formalny      profesjonalny, biznesowy   │    ║
║  │ [3] Edukacyjny    podręcznik, wyjaśnienia    │    ║
║  │ [4] Pilny/news    ważne TERAZ, krótko        │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  JĘZYK:                                              ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ [1] Polski ←  (min. 300 słów)                │    ║
║  │ [2] English    (min. 250 words)               │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  [p] Pokaż wygenerowany prompt                       ║
║  [Enter] = kontynuuj    [b] = wstecz                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 4/8 — Jakość i długość

```
╔══════════════════════════════════════════════════════╗
║     Krok 4/8: Parametry jakościowe                   ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Długość:                                            ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ Min. słów: [  300] (PL domyślnie 300)         │    ║
║  │ Max. słów: [ auto] (bez limitu)               │    ║
║  │                                              │    ║
║  │ Sugerowane długości:                          │    ║
║  │  [1] Krótki   — 300-500 słów (3 min czytania)│    ║
║  │  [2] Średni   — 500-1000 (5 min)             │    ║
║  │  [3] Długi    — 1000-2000 (10 min)           │    ║
║  │  [4] Bardzo długi — 2000+ (15+ min)          │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  Czytelność (FOG index):                             ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ [1] Łatwa ←  (FOG ≤ 40) — blog, social media │    ║
║  │ [2] Średnia    (FOG 40-60) — B2B, branżowa   │    ║
║  │ [3] Trudna     (FOG 60-80) — akademicka      │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  Retry i walidacja:                                  ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ Automatyczny retry: [x] Tak  [ ] Nie          │    ║
║  │ Max retries:        [2]                       │    ║
║  │                                              │    ║
║  │ Walidacja sprawdza:                           │    ║
║  │  ✓ title nie może być pusty                  │    ║
║  │  ✓ body nie może być puste                   │    ║
║  │  ✓ min. liczba słów                          │    ║
║  │  ✓ min. 1 znacznik <h2>                     │    ║
║  │  ✓ desc > 40 znaków                          │    ║
║  │  ✓ poziom czytelności (FOG)                  │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  [Enter] = kontynuuj    [b] = wstecz                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 5/8 — Multimedia

```
╔══════════════════════════════════════════════════════╗
║     Krok 5/8: Multimedia (opcjonalne)                ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Wybierz dodatki do artykułu:                        ║
║                                                      ║
║  [ ] Obrazek główny (AI-generated)                   ║
║      → generacja przez DALL-E / Stable Diffusion     ║
║      → automatycznie hostowany (GitHub/Cloudinary)   ║
║      → styl: [ilustracja / zdjęcie / infografika]    ║
║      → rozmiar: [landscape 1200x630 / square 800x800]║
║      → PROMPT: "e-commerce AI robot working..."      ║
║      STATUS: ⚠ wymaga API key + implementacji        ║
║                                                      ║
║  [ ] Infografika z NotebookLM                        ║
║      → generuj raport z NB → konwertuj do infografiki║
║      → Notatnik: [Sources / News]                    ║
║      STATUS: ⚠ wymaga integracji NB generate-report  ║
║                                                      ║
║  [ ] Audio podcast (NB Audio Overview)               ║
║      → automatyczna konwersacja 2-głosowa             ║
║      → Notatnik: [Audio]                             ║
║      → Format: [Deep Dive / Briefing Doc]            ║
║      STATUS: ✅ dostępne przez nb_runner.py          ║
║      CZAS: ~5-10 min generacji                       ║
║                                                      ║
║  [ ] Tabela / wykres (w prompt)                      ║
║      → poproś model o wygenerowanie <table>          ║
║      → lub danych do wykresu                         ║
║      STATUS: ✅ działa z --format vs lub list        ║
║                                                      ║
║  [x] Żadnych multimediów                             ║
║                                                      ║
║  Wybierz (oddziel spacją, np. "1 3"):                ║
║  [Enter] = kontynuuj    [b] = wstecz                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 6/8 — Akcje po wygenerowaniu

```
╔══════════════════════════════════════════════════════╗
║     Krok 6/8: Co zrobić po zapisaniu artykułu?      ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  [x] Zapisz HTML do articles/<slug>.html             ║
║      (zawsze włączone)                               ║
║                                                      ║
║  [x] Przebuduj index / sitemap / feed RSS            ║
║      → articles/index.html, sitemap.xml, feed.xml    ║
║      (zawsze włączone)                               ║
║                                                      ║
║  [x] Dodaj do generated.json (RSS-sourced)           ║
║      → tylko jeśli źródło = RSS URL                  ║
║      (auto dla RSS, off dla topic-based)             ║
║                                                      ║
║  [ ] Push na GitHub                                  ║
║      → git add + commit + push                       ║
║      → commit message: "Add: <tytuł>"                ║
║                                                      ║
║  [ ] Powiadom Google Indexing API                    ║
║      → POST urlNotifications:publish                 ║
║      → wymaga GOOGLE_INDEXING_KEY w .env             ║
║      → STATUS: ⚠ klucz nie skonfigurowany           ║
║                                                      ║
║  [ ] Opublikuj na LinkedIn                           ║
║      → post z tytułem + 300 zn body + link           ║
║      → wymaga LINKEDIN_TOKEN w .env                  ║
║      → STATUS: ⚠ token nie skonfigurowany           ║
║                                                      ║
║  [ ] Dodaj do newslettera                            ║
║      → dołączy artykuł do następnego newslettera     ║
║      → generuj newsletter jeśli >5 artykułów w tyg.  ║
║                                                      ║
║  [x] Dodaj do NotebookLM jako źródło                 ║
║      → NB Sources + NB News                          ║
║      (chyba że --no-nb)                              ║
║                                                      ║
║  Wybierz (oddziel spacją numery do przełączenia):    ║
║  [Enter] = kontynuuj    [b] = wstecz                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 7/8 — Podsumowanie i potwierdzenie

```
╔══════════════════════════════════════════════════════╗
║     Krok 7/8: Podsumowanie zamówienia                ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │ Źródło:      TechCrunch AI (RSS)              │    ║
║  │ Temat:       "OpenAI unveils first custom     │    ║
║  │              chip built by Broadcom"          │    ║
║  │ Format:      Standardowy artykuł              │    ║
║  │ Persona:     Dziennikarz                      │    ║
║  │ Ton:         Swobodny                         │    ║
║  │ Język:       Polski (min. 300 słów)            │    ║
║  │ Długość:     średnia (500-1000 słów)          │    ║
║  │ Czytelność:  łatwa (FOG ≤ 40)                │    ║
║  │ Retry:       tak (max 2)                      │    ║
║  │ Multimedia:  brak                             │    ║
║  │ Push:        tak                              │    ║
║  │ LinkedIn:    nie                              │    ║
║  │ Indexing:    nie                              │    ║
║  │ Newsletter:  tak                              │    ║
║  │ NB:          tak                              │    ║
║  │ Model:       gemma4:e4b                       │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  [Enter] = GENERUJ!                                  ║
║  [e] = Edytuj (skocz do kroku)                       ║
║  [s] = Zapisz konfigurację jako szablon              ║
║  [q] = Anuluj                                        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

**Jeśli [s] — zapisz szablon:**
```
╔══════════════════════════════════════════════════════╗
║     Zapisz konfigurację jako szablon                  ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Nazwa szablonu: [                              ]    ║
║                  └─ np. "TechCrunch → PL news"       ║
║                                                      ║
║  Zapisane w: settings.json / baza danych              ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

### KROK 8/8 — Generowanie (progres na żywo)

```
╔══════════════════════════════════════════════════════╗
║     Generowanie artykułu...                          ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  [✅] Krok 1/7 — Ładowanie modelu gemma4:e4b         ║
║        → 3.2s, gotowe                                ║
║                                                      ║
║  [⏳] Krok 2/7 — Generowanie tekstu (streaming)      ║
║        → 847 znaków | ~42% | 18.3s                   ║
║        → tokeny/s: 23.4 | szacowany czas: 25.5s      ║
║        → ═══════░░░░░░░░░░░░░ 42%                     ║
║                                                      ║
║  [ ] Krok 3/7 — Walidacja                             ║
║  [ ] Krok 4/7 — Budowanie HTML                        ║
║  [ ] Krok 5/7 — Zapis pliku + generated.json         ║
║  [ ] Krok 6/7 — Index / Sitemap / Feed                ║
║  [ ] Krok 7/7 — Post-generation akcje                 ║
║                                                      ║
║  [ctrl+c] = przerwij (zapis partial)                  ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

**Po zakończeniu — ekran sukcesu:**

```
╔══════════════════════════════════════════════════════╗
║     ✅ Artykuł wygenerowany!                         ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Tytuł:    OpenAI stawia na własne chipy: Jak        ║
║            Jalapeño może zmienić grę w AI             ║
║  Slug:     openai-stawia-na-wlasne-chipy-jak-...     ║
║  Plik:     articles/openai-stawia-na-...html (12 KB) ║
║  Słowa:    847 | H2: 4 | Czytelność: 32 (łatwa)     ║
║  Czas:     52.3s                                     ║
║                                                      ║
║  🔗 Link:                                            ║
║  https://pkrokosz.github.io/smartbuyers/articles/    ║
║  openai-stawia-na-wlasne-chipy-jak-jalapeno-moze-    ║
║  zmienic-gre-w-ai.html                               ║
║                                                      ║
║  ─────── Akcje wykonane ───────────────────────       ║
║  ✅ HTML zapisany i sformatowany                      ║
║  ✅ generated.json zaktualizowany                     ║
║  ✅ Index + sitemap + feed RSS przebudowane           ║
║  ✅ Git: commit "Add: OpenAI stawia na..."            ║
║  ✅ Git: push na master                              ║
║  ✅ NotebookLM: źródło dodane                         ║
║                                                      ║
║  [o] Otwórz w przeglądarce                           ║
║  [e] Edytuj plik (otwiera w edytorze)                ║
║  [g] Generuj kolejny artykuł (nowy wizard)           ║
║  [w] Wróć do menu głównego                           ║
║  [q] Wyjście                                         ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

## 5. Tipy kontekstowe (tooltipy)

Na każdym etapie wizarda, subtelna, zamykalna linijka podpowiedzi — nie blokuje ekranu, nie przeszkadza, user może ją zignorować, zamknąć lub rozwinąć.

### 5.1 Styl i zachowanie

- **Widoczna domyślnie** na każdym kroku — jedna linijka, dim kolor, prefix `💡`
- **`?`** — rozwija do pełnego opisu (3-5 linijek w ramce)
- **`Esc`** — zwija z powrotem
- **`x`** — chowa tip całkowicie (do końca sesji lub do ponownego `x`)
- Dim kolor — nie konkuruje z głównym UI

```
  💡 Wybierz źródło tematu — RSS feedy są najszybsze, własny temat daje pełną kontrolę  [? = więcej]
```

Po naciśnięciu `?`:

```
  ┌─ 💡 Wybierz źródło tematu — RSS feedy są najszybsze, własny temat daje pełną kontrolę ─────┐
  │ • RSS: artykuł powstaje z istniejącego newsa. AI adaptuje go do polskiego, dodaje          │
  │   kontekst branżowy, nie traci oryginalnego źródła. Idealne do newsów.                     │
  │ • Google News: dynamiczne zapytania z 67 haseł w puli. Wybierz kategorię bliską Twojej     │
  │   branży — system wylosuje zapytania i pokaże dostępne newsy.                              │
  │ • Własny: pełna dowolność — prompt, kontekst, URL źródłowy. Dla ekspertów i nietypowych    │
  │   tematów spoza RSS feedów.                                                                │
  │ • NotebookLM: użyj źródeł z notatnika jako bazy wiedzy — idealne do pogłębionych analiz.   │
  │ • Baza danych: zapisane szablony i konfiguracje — wymaga Supabase (obecnie nieaktywne).    │
  └───────────────────────────────────────────────────────────────────────────────────────────┘
  [Esc] = zwiń    [x] = ukryj tip
```

### 5.2 Pełna lista tipów per krok

| Krok | Tip krótki (1 linijka) | Rozszerzenie (`?`) |
|---|---|---|
| **1 Źródło** | Wybierz źródło tematu — RSS feedy są najszybsze, własny temat daje pełną kontrolę | Opis każdego źródła z use-case'ami |
| **1A RSS** | Feed z ● ma nowe newsy do przetworzenia. Feed z ○ nie był jeszcze sprawdzany — warto go aktywować | Wyjaśnienie statusów: ● nowe, △ sprawdzone/bez nowych, ○ nieaktywny (first run) |
| **1B Google News** | Każda kategoria zawiera zapytania Google News — wybierz kategorię bliską Twojej branży | Lista przykładowych zapytań w każdej kategorii + jak działają dynamiczne feedy |
| **1D NotebookLM** | Źródła z Twojego notatnika — użyj istniejącej bazy wiedzy jako kontekstu do artykułu | Jak dodać nowe źródła, formaty wspierane przez NB |
| **2 Temat** | Wybierz newsa — możesz podejrzeć snippet przed decyzją. Opcja [d] łączy wiele w jeden digest | Czym jest digest, kiedy go używać (5+ newsów), różnica między single a multi |
| **2-manual** | Wpisz temat — możesz dodać URL źródłowy i dodatkowy kontekst dla AI | Przykłady dobrych promptów: konkretne, z kontekstem, z target audience |
| **3 Format** | Format określa strukturę HTML, persona — styl pisania, ton — nastrój tekstu | Krótkie opisy każdego formatu (1 zdanie) + sugerowane use-case'y |
| **4 Jakość** | Długość wpływa na czas generacji i czytania. FOG mierzy trudność tekstu — dla B2B celuj w 40-60 | Co to FOG index, jak się go liczy, jakie wartości dla jakich treści |
| **5 Media** | Multimedialne dodatki — opcjonalne. Audio podcast z NB jest gotowe do użycia od ręki | Czas generacji audio (~5-10 min), wymagania, formaty |
| **6 Akcje** | Zaznacz co ma się stać po zapisaniu pliku. Push na Git publikuje artykuł na GitHub Pages | Wyjaśnienie każdej akcji: co robi, jakie ma wymagania (klucze API, tokeny) |
| **7 Podsum.** | Sprawdź ustawienia przed generacją. [e] pozwala wrócić do dowolnego kroku i poprawić | Opis opcji [e] (skocz do kroku X), [s] (zapisz jako szablon), [q] (anuluj) |
| **8 Generuj** | Generowanie trwa ~30-120s w zależności od długości i modelu. Możesz przerwać Ctrl+C — sesja zostanie zapisana | Co robić jak się zawiesi: sprawdź Ollamę (`ollama ps`), restart, fallback do OpenRouter |

### 5.3 Implementacja

```javascript
// wizard.mjs — system tipów

const TIPS = {
  "1": {
    short: "Wybierz źródło tematu — RSS feedy są najszybsze, własny temat daje pełną kontrolę",
    long: `• RSS: artykuł powstaje z istniejącego newsa...
• Google News: dynamiczne zapytania z 67 haseł w puli...
• Własny: pełna dowolność — prompt, kontekst, URL źródłowy...
• NotebookLM: użyj źródeł z notatnika jako bazy wiedzy...
• Baza danych: zapisane szablony i konfiguracje...`
  },
  "1A": { short: "Feed z ● ma nowe newsy...", long: "..." },
  "1B": { short: "Każda kategoria zawiera zapytania...", long: "..." },
  "1D": { short: "Źródła z Twojego notatnika...", long: "..." },
  "2":  { short: "Wybierz newsa — podejrzyj snippet...", long: "..." },
  "2-manual": { short: "Wpisz temat — dodaj URL i kontekst...", long: "..." },
  "3":  { short: "Format = struktura HTML, persona = styl...", long: "..." },
  "4":  { short: "Długość wpływa na czas generacji. FOG...", long: "..." },
  "5":  { short: "Multimedia — opcjonalne dodatki...", long: "..." },
  "6":  { short: "Zaznacz akcje po zapisaniu pliku...", long: "..." },
  "7":  { short: "Sprawdź ustawienia przed generacją...", long: "..." },
  "8":  { short: "Generowanie ~30-120s. Ctrl+C zapisuje sesję...", long: "..." },
};

let tipVisible = true;    // czy tip w ogóle pokazany (toggle 'x')
let tipExpanded = false;  // czy rozwinięty (toggle '?')
let currentTipKey = null; // klucz do TIPS dla bieżącego kroku

function showTip(stepKey) {
  currentTipKey = stepKey;
  const tip = TIPS[stepKey];
  if (!tip || !tipVisible) return "";

  if (tipExpanded) {
    const lines = tip.long.split("\n");
    const width = 86;
    const header = `💡 ${tip.short}`;
    let out = `\n  ┌─ ${header} ${"─".repeat(Math.max(0, width - header.length - 4))}┐\n`;
    for (const l of lines) {
      out += `  │ ${l}${" ".repeat(Math.max(0, width - l.length))}│\n`;
    }
    out += `  └${"─".repeat(width)}┘\n`;
    out += `  ${C.dim}[Esc] = zwiń    [x] = ukryj tip${C.rst}`;
    return out;
  } else {
    return `\n  ${C.dim}💡 ${tip.short}  [? = więcej]${C.rst}`;
  }
}

// W pętli klawiszy wizarda (wspólny handler):
// case '?':  tipExpanded = !tipExpanded; rerender();
// case 'x':  tipVisible = !tipVisible; rerender();
// case 27:   if (tipExpanded) { tipExpanded = false; rerender(); } // Esc
```

---

## 6. Architektura — przepływ danych

```
┌─────────────────────────────────────────────────────────────┐
│                    WIZARD.MJS (orkiestrator)                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ STEP 1   │──▶│ STEP 2   │──▶│ STEP 3   │──▶│ STEP 4   │ │
│  │ źródło   │   │ temat    │   │ format   │   │ jakość   │ │
│  │ danych   │   │          │   │ styl     │   │ długość  │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       │              │               │              │       │
│       ▼              ▼               ▼              ▼       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ STEP 5   │◀──│ STEP 6   │◀──│ STEP 7   │◀──│ STATE    │ │
│  │ media    │   │ akcje    │   │ podsum.  │   │ CONTEXT  │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       │              │              │                        │
│       └──────────────┼──────────────┘                        │
│                      ▼                                       │
│              ┌──────────────┐                                │
│              │ STEP 8       │                                │
│              │ generowanie  │                                │
│              │ + wynik      │                                │
│              └──────────────┘                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘

State context object (przekazywany między krokami):

  wiz = {
    step: 1,                    // current step (1-8)
    direction: 'forward',       // 'forward' | 'back' (dla animacji/flow)

    // Step 1 — source
    source: {
      type: null,              // 'rss' | 'googlenews' | 'manual' | 'nb' | 'database'
      feedIndex: null,         // indeks w feeds.json
      queryCategory: null,     // kategoria w queries.json
      queryText: null,         // konkretne zapytanie / własny tekst
      nbSourceId: null,        // ID źródła z NotebookLM
    },

    // Step 2 — topic
    topic: {
      items: [],               // dostępne RSS/Google News itemy
      selectedIndex: null,     // wybrany indeks
      selectedItem: null,      // pełny obiekt itemu { title, link, snippet, date }
      manualTopic: null,       // własny temat (string)
      sourceUrl: null,         // URL źródłowy
      context: null,           // dodatkowy kontekst
      mode: null,              // 'single' | 'multi' | 'digest'
    },

    // Step 3 — format & style
    config: {
      format: 'article',       // 'article' | 'list' | 'howto' | ...
      persona: 'journalist',   // 'journalist' | 'marketer' | ...
      tone: 'casual',          // 'casual' | 'formal' | ...
      lang: 'pl',              // 'pl' | 'en'
    },

    // Step 4 — quality
    quality: {
      minWords: 300,
      maxWords: null,
      fogTarget: 'easy',       // 'easy' | 'medium' | 'hard'
      autoRetry: true,
      maxRetries: 2,
    },

    // Step 5 — media
    media: {
      heroImage: false,        // AI-generated image
      imagePrompt: null,
      imageStyle: null,
      infographic: false,      // NB-generated infographic
      audioPodcast: false,     // NB Audio Overview
      audioFormat: null,       // 'deep-dive' | 'briefing-doc'
    },

    // Step 6 — post-generation
    postGen: {
      saveHtml: true,          // always
      rebuildIndex: true,      // always
      markGenerated: null,     // auto if source.type !== 'manual'
      gitPush: false,
      googleIndexing: false,
      linkedin: false,
      newsletter: false,
      nbPush: true,
    },

    // Execution state
    execution: {
      model: 'gemma4:e4b',
      useOpenRouter: false,
      result: null,            // { data, raw, valid, issues }
      html: null,
      fname: null,
      slug: null,
      pageUrl: null,
      elapsed: null,
    },
  }
```

---

## 7. Integracja z istniejącym kodem

Wizard jest **czystym UI** — nie duplikuje logiki, tylko korzysta z istniejącego REST API `menu-server/server.mjs`.

```
wizard.js (NOWY PLIK — ~500 linii web UI)
  │
  ├── Krok 1: źródło → GET /api/feeds, GET /api/queries, GET /api/topics
  │                   GET /api/research-sources, GET /api/nb/notebooks/:id/sources
  │
  ├── Krok 2: temat  → GET /api/rss/parse?url=... (dla RSS/Google News)
  │                   GET /api/topics (dla kolejki)
  │
  ├── Kroki 3-4:     → lokalne dicta (FORMATS, PERSONAS, TONES, LANGS) z app.js
  │   konfiguracja
  │
  ├── Krok 5: media  → POST /api/nb/generate-audio (NB Audio Overview)
  │                   → POST /api/nb/generate-report (NB infografika)
  │
  ├── Krok 6: akcje  → POST /api/run/generate (z body: topic, format, persona, push)
  │   post-gen       → POST /api/run/generate?push=true
  │                   → POST /api/nb/source-add (dodaj źródło do NB)
  │
  ├── Krok 7:         → render podsumowania z lokalnego state
  │   podsumowanie
  │
  └── Krok 8:         → GET /api/run/:runId/stream (SSE streaming)
      generowanie     → EventSource nasłuchuje stdout, exit, error
```

**Mapa endpointów `server.mjs` → wizard:**

| Funkcja | Endpoint | Linia |
|---|---|---|
| Lista feedów RSS | `GET /api/feeds` | 783-789 |
| Parsowanie RSS feeda | `GET /api/rss/parse?url=...` | 792-809 |
| Zapytania Google News | `GET /api/queries` | 569-575 |
| Kolejka tematów | `GET/POST/DELETE /api/topics` | 812-862 |
| Research sources DB | `GET/POST /api/research-sources` | 865-911 |
| Research results | `GET/POST /api/research-results` | 914-953 |
| Model AI (Ollama) | `GET /api/models` | 293-300 |
| Ustawienia | `GET/POST /api/settings` | 272-290 |
| Uruchom generowanie | `POST /api/run/generate` | 255-269 |
| SSE stream z generowania | `GET /api/run/:runId/stream` | 191-202 |
| Warmup modelu | `GET /api/warmup` | 690-715 |
| NB: lista notatników | `GET /api/nb/notebooks` | 348-352 |
| NB: źródła notatnika | `GET /api/nb/notebooks/:id/sources` | 432-439 |
| NB: dodaj źródło | `POST /api/nb/source-add` | 459-471 |
| NB: generuj raport | `POST /api/nb/generate-report` | 395-407 |
| NB: generuj audio | `POST /api/nb/generate-audio` | 409-421 |
| NB: deep research | `POST /api/nb/add-research` | 380-393 |
| NB: autoryzacja | `GET /api/nb/auth-status` | 314-323 |
| Git status | `GET /api/git-status` | 592-602 |
| Lista artykułów | `GET /api/articles` | 718-747 |

### Komunikacja z NotebookLM (nb_runner.py)

Wizard nie woła Pythona bezpośrednio w trakcie UI (blokowanie event loopu). Zamiast tego:
1. Step 1 — `nb source-list` wywoływane tylko gdy user wybierze opcję NB
2. Step 5 — `nb generate-audio` jako osobny krok po zapisie artykułu (async)
3. Step 6 — `nb source-add` w tle po zapisie

Używamy `execSync` jak dotychczas, ale z timeoutem i fallbackiem.

---

## 8. Baza danych — co już mamy vs Supabase

Wizard nie potrzebuje Supabase od razu — nowy kod na gicie wprowadza już warstwę "bazy danych" opartą o JSON API.

### 8.1 Co już jest (wystarczy do wizarda MVP)

| Plik | API | Rola w wizardzie |
|---|---|---|
| `topic-queue.json` | `GET/POST/DELETE /api/topics` | Kolejka tematów do przetworzenia — wizard może dodawać tematy "na później" |
| `research-sources.json` | `GET/POST /api/research-sources` | Baza źródeł z kategoriami — wizard Step 1 wyświetla źródła do wyboru |
| `research-results.json` | `GET/POST /api/research-results` | Log wyników deep research — kontekst do generowania |
| `generated.json` | `GET /api/articles` | Historia artykułów — Step 2 pokazuje co już wygenerowane |
| `feeds.json` | `GET /api/feeds` | Konfiguracja feedów — Step 1 pokazuje dostępne RSS |
| `queries.json` | `GET /api/queries` | Pula zapytań Google News — Step 1B kategorie |
| `settings.json` | `GET/POST /api/settings` | Preferencje + szablony — Step 7 save/load template |

### 8.2 Supabase — przyszła faza

Supabase wchodzi gdy:
- Potrzebujemy wielu użytkowników (auth)
- Chcemy pełnej analityki per-artykuł (SQL queries)
- Potrzebujemy realtime powiadomień

Schemat SQL z sekcji 8.2 (poprzednia wersja planu) pozostaje jako referencja. Na ten moment wystarczają pliki JSON + REST API.

### 8.3 Strategia wdrożenia

**Faza 1 (teraz):** Wizard używa istniejących endpointów `/api/topics`, `/api/research-sources`, `/api/feeds`, `/api/queries`, `/api/articles`. Zero nowych zależności.
**Faza 2 (później):** Dodajemy kolekcję `templates` w `settings.json` dla szablonów wizarda.
**Faza 3 (przyszłość):** Supabase jako replacement dla JSON-owego "store" — zmiana tylko w warstwie API, wizard UI bez zmian.

---

## 9. Plan implementacji

### Faza 1: Core wizard — Web UI (2-3 dni)

Pliki do utworzenia / zmodyfikowania:

| Plik | Akcja | Opis |
|---|---|---|
| `menu-server/public/wizard.js` | **NOWY** | Logika kreatora (~500 linii), 8 kroków, komunikacja przez REST API |
| `menu-server/public/wizard.css` | **NOWY** | Style: progress bar, karty kroków, tooltipy, dialog potwierdzenia |
| `menu-server/public/app.js` | **EDYCJA** | Dodać tile "✦ Nowy Artykuł" + routing `wizard` level + 3 helpery |
| `lib/shared.mjs` | **BEZ ZMIAN** | Wizard nie potrzebuje — komunikuje się przez REST API |
| `docs/article-wizard-plan.md` | **JUŻ STWORZONY** | Ten dokument |

**Struktura `wizard.js`:**
```javascript
// wizard.js — struktura (pseudokod)
// Renderowane jako widok w istniejącym systemie pushLevel/popLevel

const WIZARD_STATE = {
  step: 1,  // 1-8
  source: { type: null, feedIndex: null, ... },
  topic: { items: [], selectedItem: null, ... },
  config: { format: 'article', persona: 'journalist', tone: 'casual', lang: 'pl' },
  quality: { minWords: 300, fogTarget: 'easy', autoRetry: true, maxRetries: 2 },
  media: { heroImage: false, audioPodcast: false, ... },
  postGen: { gitPush: false, linkedin: false, nbPush: true, ... },
  execution: { model: 'gemma4:e4b', result: null, pageUrl: null },
};

const STEP_HANDLERS = {
  1: renderSourceStep,    // GET /api/feeds, /api/queries, /api/research-sources...
  2: renderTopicStep,     // GET /api/rss/parse?url=... lub manual input
  3: renderConfigStep,    // lokalne dicta FORMATS, PERSONAS, TONES, LANGS
  4: renderQualityStep,   // sliders, checkboxes
  5: renderMediaStep,     // NB: generuj audio/raport
  6: renderPostGenStep,   // checkboxes: push, linkedin, indexing, newsletter, nb
  7: renderSummaryStep,   // podsumowanie + przycisk [Generuj]
  8: renderGenerateStep,  // POST /api/run/generate + SSE EventSource
};

function render() {
  const step = WIZARD_STATE.step;
  $('#wizardProgress').innerHTML = renderProgressBar(step);
  $('#wizardContent').innerHTML = STEP_HANDLERS[step]();
  showTooltip(step);  // tip z TIPS map
}
```

### Faza 2: Szablony i historia (1 dzień)

- Zapis / odczyt szablonów przez `POST /api/settings` (pole `templates: []`)
- Zapisz stan wizarda jako szablon do ponownego użycia
- Historia ostatnich 5 konfiguracji w `localStorage`
- Auto-restore sesji przy powrocie do wizarda

### Faza 3: Supabase (2-3 dni)

- `lib/store.mjs` z abstrakcją JSONStore / SupabaseStore
- Migracja schematu
- Seed istniejących danych do Supabase
- Wizard używa store zamiast bezpośrednich odczytów plików

### Faza 4: Media (osobny projekt)

- Generacja obrazów (DALL-E / Stable Diffusion przez API)
- Hosting obrazów (Cloudinary / GitHub)
- Integracja z NotebookLM Audio Overview
- Infografiki z NB Report → HTML/CSS

---

## 10. Edge cases & error handling

| Przypadek | Obsługa |
|---|---|
| Ollama offline | Step 8 wykrywa przy warmup — komunikat, propozycja zapisania configu do kolejki |
| RSS feed zwraca błąd | Step 2 — komunikat "nie można pobrać feedu", propozycja ponowienia / pominięcia |
| Brak nowych itemów w feedzie | Step 2 — "brak nowych, chcesz wygenerować z istniejącego?" |
| JSON parse fail w odpowiedzi AI | Retry (max 2 razy), fallback: zapisz raw do pliku, informuj usera |
| Zbyt mało słów | Retry (jeśli auto-retry włączone), inaczej zapisz z warningiem |
| Git push fail (brak dostępu) | Komunikat, propozycja manualnego pusha |
| NotebookLM offline | Pomija NB, nie blokuje całego flow |
| Duplikat sluga | Dodaj suffix `-2`, `-3` do sluga |
| Przerwanie Ctrl+C | Zapisz partial state do `.wizard-session.json` |
| Przekroczenie timeoutu generacji | 120s limit, komunikat "model może być przeciążony" |

---

## 11. Kolejność wdrożenia

```
  Tydzień 1         Tydzień 2         Tydzień 3+
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Faza 1:       │ │ Faza 2:      │ │ Faza 3+4:    │
│ Core wizard   │ │ Szablony +   │ │ Supabase +   │
│ CLI            │ │ historia     │ │ media        │
│                │ │              │ │              │
│ ✓ wizard.mjs  │ │ ✓ templates  │ │ ✓ store.mjs  │
│ ✓ 8 kroków    │ │ ✓ session    │ │ ✓ Supabase   │
│ ✓ integracja  │ │   restore    │ │ ✓ images     │
│   z shared.mjs│ │ ✓ quick      │ │ ✓ audio NB   │
│ ✓ menu.mjs [0]│ │   restart    │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 12. Sygnatury funkcji (kontrakt dla implementacji)

```javascript
// wizard.js — kluczowe funkcje

// --- Stan ---
function createInitialState() → WizardState
  // Świeży stan z domyślnymi wartościami + ładuje settings z GET /api/settings

// --- API helpers (wszystkie async, zwracają sparsowany JSON) ---
async function apiGet(path) → Object
  // fetch(path).then(r => r.json()) z obsługą błędów

async function apiPost(path, body) → Object
  // fetch(path, { method:'POST', body: JSON.stringify(body) }).then(r => r.json())

// --- Źródła danych (Krok 1) ---
async function loadFeeds() → Array
  // GET /api/feeds → [{name, url, mode, filter, lastGuid}]

async function loadQueries() → { pool: string[] }
  // GET /api/queries → { pool: [...] }

async function loadResearchSources(category?) → { sources: Array }
  // GET /api/research-sources?category=X

async function loadNbNotebooks() → Array
  // GET /api/nb/notebooks

async function loadNbSources(notebookId) → Array
  // GET /api/nb/notebooks/:id/sources

// --- Tematy (Krok 2) ---
async function fetchRssItems(feedUrl) → { feed, items: Array }
  // GET /api/rss/parse?url=...

async function loadTopicQueue() → { topics: Array }
  // GET /api/topics

// --- Generowanie (Krok 8) ---
async function startGeneration(body) → { ok, runId }
  // POST /api/run/generate z pełną konfiguracją

function streamGeneration(runId, onData, onDone, onError) → void
  // new EventSource('/api/run/' + runId + '/stream')

// --- Render (wszystkie zwracają HTML string) ---
function renderProgressBar(step) → string
  // <div class="wiz-progress"> 8 kropek/kropek </div>

function renderSourceStep() → string
function renderTopicStep() → string
function renderConfigStep() → string
function renderQualityStep() → string
function renderMediaStep() → string
function renderPostGenStep() → string
function renderSummaryStep() → string
function renderGenerateStep() → string

// --- Tooltipy ---
function showTooltip(stepKey) → void
function hideTooltip() → void
function toggleTooltip() → void

// --- Szablony ---
function saveTemplate(name, config) → void
  // localStorage + POST /api/settings
function loadTemplate(name) → WizardState | null
```

---

## 13. Podsumowanie

Wizard to naturalna ewolucja Tile UI — zamiast pamiętania flag CLI i skakania między narzędziami, użytkownik przechodzi przez 8 prostych kroków w przeglądarce, na każdym widząc dostępne opcje z istniejącego ekosystemu. Wizard nie duplikuje kodu — jest czystą warstwą UI nad REST API `menu-server/server.mjs`.

**Główne zalety:**
- Zero nauki składni — wszystko klikalne, karty, dropdowny
- Pełna widoczność — user widzi co wybrał w podsumowaniu przed generacją
- Elastyczność — każdy krok można pominąć (domyślne wartości)
- Szablony — zapisz ulubioną konfigurację i używaj jednym kliknięciem
- Live streaming — SSE pokazuje postęp generowania w czasie rzeczywistym
- Rozszerzalność — nowe formaty/persony/multimedia dodaje się w jednym miejscu

**Co NIE jest w scope tego planu (osobne projekty):**
- Generowanie obrazków AI (DALL-E / Stable Diffusion)
- Multi-user / auth
- Zaawansowana analityka SEO
- Automatyczna moderacja treści
