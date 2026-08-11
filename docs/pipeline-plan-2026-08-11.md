# KROKIET NEWS — plan pipeline'u i status (2026-08-11)

> Notka dla agenta contentowego (MCP / drugi komputer). Opisuje pomysł, co już
> działa w pipeline, co zostało naprawione i co z tego można przekuć w content.

## Cel

Utrzymywać **4–8 artykułów/dobę** na KROKIET NEWS, bez powtarzalności stylu
i bez zalewania stron mdłymi digestami. Rotacja formatów/person/tonów/kątów,
filtrowanie słabych źródeł, budżet dzienny.

## Architektura (skrót)

- **`rss-watch.mjs`** — cron co 30 min (`--push --digest`): czyta `settings.json`
  + `feeds.json`, nowe wpisy RSS → generowanie artykułów → zapis
  `articles/<slug>.html` → push do git (GitHub Pages) + treść do Firebase
  (`krokiet_news/index/<slug>`).
- **`lib/agent.mjs`** (NOWE) — "agent różnorodności":
  - `ANGLES`: 8 kątów dziennikarskich (data/question/story/problem/myth/future/cost/checklist).
  - `pickPath()`: format rotuje (`state.formatSeq` — nigdy 2× z rzędu), persona/
    ton/kąt wybierane metodą least-used z historii 12, język pl z wyjątkiem co
    10-tego en, temperatura 0.3–0.62. Stan w `variety-state.json`.
  - Flagi `--format/--persona/--tone/--lang` nadpisują; `--agent off` wyłącza.
- **Digest** (1–2/dobę): gate ≥ `_digestMin: 3` wpisów, throttle `_digestEveryHours: 12`,
  bufor `digest-pending.json`, max 15 sekcji, anty-placeholder (retry 1×, potem odrzuć).
- **Reddit**: `digest: false` + filtr want-adów (`block` w `feeds.json`) + `minLen: 300`.
  Przefiltrowane wpisy mogą trafiać do pojedynczych artykułów, nigdy do digestu.
- **Budżet dzienny** `_dailyBudget: 8` (run-state, reset przy zmianie dnia),
  `_singlesPerRun: 2` pojedyncze + reszta do digestu.

## Co naprawiono tym commitem

1. **Publikacja stron artykułów** — `rss-watch.mjs` commituje teraz cały `articles/`
   (`gitPush("articles/ generated.json")`) zamiast tylko `sitemap/feed/generated.json`.
   Wcześniej nowe artykuły RSS były w Firebase (widoczne w SPA) ale ich linki
   `pkrokosz.pl/articles/<slug>.html` dawały **404**, a feed.xml prowadził w martwe linki.
2. **Digest cap** — max 15 sekcji, bufor nie rośnie w nieskończoność.
3. **Reddit w cronie** — filtrowane wpisy mogą wypełnić sloty pojedynczych artykułów.
4. **Dashboard** — per-artykułowe nadpisycia formatu/persony działają też przy włączonym agencie.
5. **Czystka** — usunięto 290 wpisów `slug="digest"` z `generated.json` (zostało 61),
   zregenerowano index/sitemap/feed (0 linków do `digest.html`).

## Status

- Master jest **21 commitów przed origin/master** — ten push wyrównuje stan.
- Po pushu: `pkrokosz.pl` (SPA, treść z Firebase) + `pkrokosz.pl/articles/*.html`
  (GitHub Pages) + `feed.xml`/`sitemap.xml` na żywo.
- `generated.json`: 61 wpisów; 49 kluczy z `|` (klejone URL-e) do ewentualnego
  czyszczenia w przyszłości.

## Pomysł / co można przekuć w content

- **Formaty** do wykorzystania przez agenta contentowego: 8 formatów × 5 person
  (journalist/analyst/storyteller/guide/contrarian) × 4 tony × 8 kątów.
- Wartościowe kąty do pogłębienia: data (co mówią liczby), myth (rozbrajanie mitów
  dropshippingu), cost (ile naprawdę kosztuje), checklist (praktyczne przewodniki).
- Reddit r/dropshipping + r/ecommerce jako źródło realnych problemów → format
  "problem/solution" (bez want-adów).
- Możliwa rozbudowa: weekly newsletter, kategorie/tagi, głębsze artykuły evergreen
  (zamiast digestów) oparte na 8 kątach.

## Komendy

- Ręczne uruchomienie: `node rss-watch.mjs --push --digest`
- Tylko pojedynczy artykuł: `node generate.mjs "temat" --format <fmt> --persona <p> --tone <t> --push`
- Dashboard: `node menu-server/server.mjs` → http://localhost:XXXX
