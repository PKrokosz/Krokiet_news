# KROKIET NEWS — Plan: Live Progress Everywhere

Audyt wykonany 2026-06-25. Znaleziono 20+ "suchych miejsc" gdzie użytkownik czeka bez wizualnego feedbacku.

---

## P1 CRITICAL: NB Operations — Zero Feedback (do 10 min)

### 1A. `nb_runner.py` — `_cli()` blokuje bez outputu
- **Plik:** engines/nb_runner.py:16-29
- **Problem:** `subprocess.run(capture_output=True)` — blokuje do 600s, zero stdout/stderr
- **Czas:** 30s (list) do 600s (generate-audio)
- **Fix:** Dodać `print(f"⏳ {action_name}...", flush=True)` przed wywołaniem _cli w każdej funkcji cmd_*

### 1B. `nbExec()` — 20+ endpointów z execSync
- **Plik:** server.mjs:308-321
- **Problem:** execSync blokuje Node, HTTP request wisi, UI zamrożone
- **Fix:** Przycisk "Podsumowanie/Źródła" w NB Category — migracja na SSE streaming (jak /api/run/nb)

### 1C. `analyze.mjs` — 3×300s execSync
- **Plik:** analyze.mjs:44-51  
- **Problem:** Deep research loop — 15 min ciszy
- **Fix:** Console.log przed każdym research; rozważyć async exec

---

## P2 HIGH: Article Generation + NB Streaming

### 2A. Article live preview
- **Plik:** lib/shared.mjs streamResponse():185
- **Problem:** Co 40 tokenów print → chunk, między chunkami 5-15s ciszy
- **Fix:** Emitować `[CHUNK] <text>` co każde 5 tokenów zamiast 40

### 2B. NB heartbeat
- **Plik:** server.mjs spawnNbRun()
- **Problem:** exec() buforyzuje output — 5-30s między SSE eventami
- **Fix:** Dodać setInterval co 10s wysyłający `{"type":"heartbeat"}`

### 2C. rss-watch warmup
- **Plik:** rss-watch.mjs:108-116
- **Problem:** Zero progress podczas ładowania modelu (2 min)
- **Fix:** Dodać 5s progress dots (jak generate.mjs)

### 2D. rss-watch nbPushSource/Article
- **Plik:** rss-watch.mjs:9-21
- **Problem:** execSync na każdym artykule (60s × N)
- **Fix:** Async exec + print przed/po

---

## P3 MEDIUM: UI Progress Views

### 3A. renderProgress — live article preview panel
- **Plik:** app.js renderProgress()
- **Problem:** 8-step + log techniczny, brak podglądu treści
- **Fix:** Panel dwukolumnowy (kroki | live preview) dla akcji generate/rss

### 3B. renderProgress — warmup
- **Plik:** app.js renderProgress()
- **Problem:** Warmup pokazuje 8-step pipeline zamiast pojedynczego paska
- **Fix:** Wykryć akcję warmup → prosty pasek + "Ładowanie modelu"

### 3C. renderProgress NB branch
- **Plik:** app.js renderProgress() NB branch
- **Problem:** "Oczekiwanie na odpowiedź..." bez ETY, bez faz
- **Fix:** Pokazać nazwę akcji NB, szacowany czas, heartbeat animację

### 3D. Batch queue progress
- **Plik:** server.mjs spawnQueueItem()
- **Problem:** Tylko `[N/T] title` przed każdym itemem
- **Fix:** Trackować sukcesy/porażki, pokazać live counter

---

## P4 LOW: Fast Operations with Spinner

### 4A. handleNbAction summary/sources
- **Plik:** app.js:1096-1117
- **Problem:** Tylko .running CSS, bez timera
- **Fix:** Mini-progress z elapsed time

### 4B. gitPush / googleIndexingPing / nbPush
- **Plik:** lib/shared.mjs, generate.mjs
- **Problem:** execSync blokuje bez komunikatu przed
- **Fix:** Console.log przed każdym wywołaniem

---

## Plan wdrożenia — kolejność

### Faza 1: NB feedback (największy impact, najmniej kodu)
1. `nb_runner.py` — print() przed każdą długą operacją (+10 linii)
2. `server.mjs` spawnNbRun — heartbeat co 10s (+5 linii)
3. `app.js` renderProgress NB — pokaż nazwę akcji + szacowany czas (+10 linii)

### Faza 2: Article live preview (wow factor)
4. `lib/shared.mjs` streamResponse() — [CHUNK] co 5 tokenów (+3 linii)
5. `app.js` renderProgress — panel live preview (+30 linii)
6. `style.css` — article-live-preview CSS (+20 linii)

### Faza 3: Pozostałe
7. `rss-watch.mjs` warmup — progress dots (+10 linii)
8. Pozostałe console.log przed execSync (+15 linii)
