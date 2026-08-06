## Wymagania

- [Node.js 18+](https://nodejs.org/)
- [NVIDIA API key](https://build.nvidia.com) — ustaw zmienną środowiskową `NVIDIA_API_KEY`

## Instalacja

```powershell
git clone https://github.com/PKrokosz/smartbuyers.git
cd smartbuyers
npm install
```

## Klucz API NVIDIA

```powershell
# Ustaw zmienną środowiskową (stała dla użytkownika)
setx NVIDIA_API_KEY "nvapi-..."

# Sprawdź
$env:NVIDIA_API_KEY
```

Domyślny model: `nvidia/llama-3.3-nemotron-super-49b-v1` — zmień w `settings.json`.

## Konfiguracja RSS (opcjonalnie)

Edytuj `feeds.json`:
```json
[
  {
    "name": "TechCrunch AI",
    "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "lastGuid": null
  }
]
```

Dodaj dowolny RSS feed. `lastGuid` aktualizuje się automatycznie.

## Harmonogram (Windows)

```powershell
# Skonfiguruj Task Scheduler na 30 minut
# (lub uruchom ręcznie: node rss-watch.mjs)
```
