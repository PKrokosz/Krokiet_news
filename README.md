<div align="center">

# KROKIET NEWS

**Terminal news feed engine** — RSS → AI → HTML → GitHub Pages.

[![Node version](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a?style=flat-square)](https://nodejs.org)
[![NVIDIA API](https://img.shields.io/badge/NVIDIA-API-76b900?style=flat-square)](https://build.nvidia.com)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-222?style=flat-square)](https://pkrokosz.github.io/smartbuyers)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](LICENSE)
<br>
[![site](https://img.shields.io/badge/site-pkrokosz.github.io/smartbuyers-159957?style=flat-square)](https://pkrokosz.github.io/smartbuyers)

[Features](#features) • [Getting Started](#getting-started) • [Usage](#usage) • [Architecture](#architecture) • [Project Structure](#project-structure)

</div>

KROKIET NEWS monitors RSS feeds, generates structured SEO articles using NVIDIA NIM API (LLM inference), and publishes them to GitHub Pages as a terminal-styled news feed — fully automated. It uses NVIDIA's hosted models with streaming support for fast, high-quality content generation.

## Features

- **AI Article Generation** — 8 content formats (article, list, how-to, FAQ, comparison, opinion, digest, myth-buster), 5 writing personas, 4 tones, 2 languages (PL/EN)
- **RSS Feed Monitoring** — Watches multiple feeds, deduplicates by GUID, filters by keywords, supports dynamic Google News query rotation
- **SEO-ready HTML** — Schema.org JSON-LD, Open Graph, Twitter Cards, meta tags, sitemap.xml, RSS feed.xml
- **Competitor Tracking** — Track competitor feeds in a separate log (`mode: "track"`), analyzed in gap reports
- **Content Gap Analysis** — TF-IDF keyword extraction from article HTML, identifies sparse topics, produces structured `gap-report.json`
- **Terminal feed homepage** — boot screen, keyboard-driven menu, tag filtering and full article reading in a CRTs-styled UI
- **Distribution Pipeline** — Auto git push to GitHub Pages, Google Indexing API ping, LinkedIn auto-post, weekly newsletter digest
- **Cloud-powered** — Runs on NVIDIA NIM API. Optional OpenRouter for cloud models
- **Menu-driven** — `node menu.mjs` provides access to all features without remembering CLI flags

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [NVIDIA API key](https://build.nvidia.com) — set as `NVIDIA_API_KEY` environment variable

```bash
# Clone
git clone https://github.com/PKrokosz/smartbuyers.git
cd smartbuyers

# Install
npm install

# Set API key
setx NVIDIA_API_KEY "nvapi-..."
```

> [!TIP]
> For optimal output quality, use a model with at least 7B parameters. Smaller models like `qwen2.5:1.5b` work but produce less nuanced articles.

## Usage

The easiest way to use KROKIET NEWS is through the interactive menu:

```bash
node menu.mjs
```

This provides access to all features:

| # | Mode | Description |
|---|------|-------------|
| 1 | **Generate from topic** | Enter any topic, get a full SEO article |
| 2 | **Generate from RSS** | Pick a news item from any RSS feed |
| 3 | **Auto-watch RSS** | Continuous generation from configured feeds |
| 4 | **Review RSS** | Manual review before each article is generated |
| 5 | **Gap analysis** | TF-IDF keyword analysis + competitor tracking |
| 6 | **Newsletter** | Generate weekly HTML digest |
| 7 | **Settings** | Change model, format, persona, tone, language, query rotation |

### Settings

Settings are persisted in `settings.json`. Access them via the menu or edit directly:

```json
{
  "model": "nvidia/llama-3.3-nemotron-super-49b-v1",
  "format": "article",
  "persona": "journalist",
  "tone": "casual",
  "lang": "pl",
  "queries": 0
}
```

> [!NOTE]
> Setting `queries` to a number (1-20) enables dynamic Google News rotation. For each run, N random queries are picked from `queries.json` and constructed as Google News RSS feeds — providing continuous fresh content.

### RSS Feeds

Configure feeds in `feeds.json`:

```json
[
  {
    "name": "TechCrunch AI",
    "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "mode": "generate",
    "filter": null
  },
  {
    "name": "Competitor Blog",
    "url": "https://competitor.com/blog/feed/",
    "mode": "track",
    "filter": null
  }
]
```

Two modes are available:
- **`generate`** — generates articles from matching feed items
- **`track`** — logs items to `competitors.json` for gap analysis (no article generation)

The optional `filter` array restricts processing to items matching any keyword.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_INDEXING_KEY` | Google Indexing API key for instant indexing pings |
| `NVIDIA_API_KEY` | **Required** — NVIDIA NIM API key for LLM inference |
| `OPENROUTER_KEY` | Enables cloud models via OpenRouter (falls back from NVIDIA) |
| `LINKEDIN_TOKEN` | LinkedIn OAuth token for auto-posting |

## Architecture

```
menu.mjs                          # Interactive CLI menu
  ├── generate.mjs                # Single article from topic or RSS
  │     ├── lib/shared.mjs        # Colors, prompts, validation, streaming,
  │     │                         # HTML builder, git, sitemap, feed, Indexing API
  │     └── social.mjs            # LinkedIn auto-poster
  ├── rss-watch.mjs               # Automated RSS watcher
  │     ├── lib/shared.mjs        # (same shared module)
  │     ├── social.mjs            # LinkedIn post on push
  │     └── newsletter.mjs        # Weekly digest generator
  ├── analyze.mjs                 # Content gap + competitor analysis
  └── newsletter.mjs              # Standalone newsletter builder
```

### Data Flow

```
RSS feed / topic → prompt builder (format+persona+tone+lang)
                → NVIDIA NIM / OpenRouter streaming
                → JSON validation + retry
                → HTML builder (Schema.org, OG, Twitter)
                → save to articles/ + mark in generated.json
                → regenerate index.html (terminal feed), sitemap.xml, feed.xml
                → git push → Google Indexing ping → LinkedIn post
```

### Deduplication

All scripts share `generated.json` as the single source of truth. Each generated article is mapped by its source URL to a slug and date. The same news item is never generated twice — across any mode.

```json
{
  "https://techcrunch.com/...": { "slug": "ai-breakthrough-2026", "date": "2026-06-24" }
}
```

## Project Structure

```
smartbuyers/
├── menu.mjs              # Entry point — interactive menu
├── generate.mjs          # Topic/RSS article generator
├── rss-watch.mjs         # Automated RSS watcher
├── analyze.mjs           # Content gap + TF-IDF analyzer
├── newsletter.mjs        # Weekly newsletter builder
├── social.mjs            # LinkedIn auto-poster
├── lib/
│   └── shared.mjs        # Shared module (CSS, HTML builder, git, providers)
├── feeds.json            # RSS feed configuration
├── queries.json          # Google News query pool
├── generated.json        # Deduplication state
├── competitors.json      # Competitor tracking data
├── settings.json         # Persisted user settings
├── gap-report.json       # Latest analysis report
├── index.html            # Terminal news feed homepage
├── articles/             # Generated HTML + sitemap + feed + newsletter
└── menu-server/          # Tile UI dashboard (article generation control)
```

## Automation (Windows Task Scheduler)

```powershell
# Create a scheduled task running every 30 minutes
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "D:\smartbuyers\rss-watch.mjs" -WorkingDirectory "D:\smartbuyers"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 30) -AtStartup
Register-ScheduledTask -TaskName "KROKIET NEWS RSS" -Action $action -Trigger $trigger -RunLevel Highest
```

