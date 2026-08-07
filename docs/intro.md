# KROKIET NEWS — Terminal Feed Engine

**Autonomiczny generator artykułów SEO** w stylu terminala. Pobiera angielskie newsy przez RSS, przetwarza na polskie artykuły przez NVIDIA API, publikuje automatycznie na GitHub Pages jako terminalowy feed.

- 📡 **RSS → AI → HTML → GitHub Pages** — pełny pipeline bez ręcznej pracy
- 🧠 **NVIDIA API** — model `nvidia/llama-3.3-nemotron-super-49b-v1` (z fallbackiem OpenRouter)
- 💻 **Terminalowy feed** — boot screen, menu klawiaturą, tagi, czytanie artykułów w stylu CRT
- 🔍 **SEO-ready** — Schema.org JSON-LD, Open Graph, sitemap.xml, meta tags
- 🛡️ **Deduplikacja** — `generated.json` pilnuje, żeby żaden news nie powstał dwa razy
- ⏰ **Auto-harmonogram** — Windows Task Scheduler co 30 minut
- 📊 **Pełna telemetria** — każdy krok widoczny w konsoli z kolorami ANSI

Strona: [pkrokosz.github.io/smartbuyers](https://pkrokosz.github.io/smartbuyers/)
