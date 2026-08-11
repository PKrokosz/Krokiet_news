import { readFileSync, writeFileSync } from "fs";

const STATE_FILE = "variety-state.json";
const HISTORY_MAX = 12;

export const ANGLES = {
  data: "Zacznij od mocnej liczby, danych lub statystyki, a dopiero potem przejdź do kontekstu.",
  question: "Zacznij od pytania wprost do czytelnika, na które odpowiadasz w artykule.",
  story: "Zacznij od krótkiej sceny lub anegdoty ilustrującej temat.",
  problem: "Zacznij od konkretnego problemu czytelnika i od razu wskaż rozwiązanie.",
  myth: "Zacznij od popularnego mitu lub błędnego przekonania i go obal.",
  future: "Zacznij od spojrzenia w przyszłość — dokąd to zmierza za 1-3 lata.",
  cost: "Zacznij od pieniędzy — ile kosztuje, ile można zarobić lub zaoszczędzić.",
  checklist: "Zacznij od obietnicy konkretnej listy lub podsumowania, które czytelnik dostaje na końcu.",
};

const ROT_FORMATS = ["article", "list", "howto", "explainer", "vs", "myth", "faq", "opinion"];
const PERSONA_KEYS = ["journalist", "marketer", "technical", "ceo", "customer"];
const TONE_KEYS = ["casual", "formal", "educational", "urgent"];
const LANG_KEYS = ["pl", "en"];

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function pickLeastUsed(keys, history, key) {
  const counts = {};
  for (const k of keys) counts[k] = 0;
  for (const h of history) if (h && counts[h[key]] !== undefined) counts[h[key]]++;
  const min = Math.min(...Object.values(counts));
  const least = keys.filter(k => counts[k] === min);
  return least[Math.floor(Math.random() * least.length)];
}

export function pickPath(explicit = {}) {
  const state = loadState();
  const seq = (state.seq || 0) + 1;
  const history = Array.isArray(state.last) ? state.last.slice(-HISTORY_MAX) : [];

  const lang = explicit.lang || LANG_KEYS[(seq % 10) === 0 ? 1 : 0];

  const format = explicit.format || (() => {
    const len = ROT_FORMATS.length;
    const idx = state.formatSeq || 0;
    let fmt = ROT_FORMATS[idx % len];
    let guard = 0;
    while (history.length && history[history.length - 1].fmt === fmt && guard < len) {
      fmt = ROT_FORMATS[(idx + ++guard) % len];
    }
    state.formatSeq = (idx + guard + 1) % len;
    return fmt;
  })();

  const persona = explicit.persona || pickLeastUsed(PERSONA_KEYS, history, "per");
  const tone = explicit.tone || pickLeastUsed(TONE_KEYS, history, "tone");
  const angle = explicit.angle || pickLeastUsed(Object.keys(ANGLES), history, "angle");
  const temperature = +(0.3 + ((seq * 7) % 5) * 0.08).toFixed(2);

  history.push({ fmt: format, per: persona, tone, angle, lang, seq });
  state.last = history.slice(-HISTORY_MAX);
  state.seq = seq;
  saveState(state);

  return { format, persona, tone, lang, angle, temperature, seq };
}
