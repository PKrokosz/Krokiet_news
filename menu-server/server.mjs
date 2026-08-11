import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawn, exec, execSync } from "child_process";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import RssParser from "rss-parser";

const rssParser = new RssParser();

const PORT = 3000;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, "public");
const ROOT = path.resolve(DIR, "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const runs = new Map();

function uid() { return randomBytes(8).toString("hex"); }

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("data: " + JSON.stringify({ type: "connected" }) + "\n\n");
}

function sendSSE(res, data) {
  try { res.write("data: " + JSON.stringify(data) + "\n\n"); } catch {}
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

const TOPICS_PATH = path.join(ROOT, "topic-queue.json");
let topics = readJSON(TOPICS_PATH);
if (!Array.isArray(topics)) topics = [];
function saveTopics() { writeFileSync(TOPICS_PATH, JSON.stringify(topics, null, 2)); }

const RESEARCH_PATH = path.join(ROOT, "research-results.json");
let researchLog = readJSON(RESEARCH_PATH);
if (!Array.isArray(researchLog)) researchLog = [];
function saveResearch() { writeFileSync(RESEARCH_PATH, JSON.stringify(researchLog, null, 2)); }

const SOURCES_DB_PATH = path.join(ROOT, "research-sources.json");
let sourcesDb = readJSON(SOURCES_DB_PATH);
if (!Array.isArray(sourcesDb)) sourcesDb = [];
function saveSourcesDb() { writeFileSync(SOURCES_DB_PATH, JSON.stringify(sourcesDb, null, 2)); }

function spawnRun(run) {
  let body = {};
  try { if (run.body) body = JSON.parse(run.body); } catch {}

  const s = readJSON(path.join(ROOT, "settings.json")) || {};

  // Build command
  let script, args = [];

  if (run.action === "generate") {
    script = "generate.mjs";
    args.push(body.topic || "Czym jest dropshipping B2B");
  } else if (run.action === "rss") {
    script = "generate.mjs";
    args.push("--rss", body.url || "https://techcrunch.com/category/artificial-intelligence/feed/");
  } else if (run.action === "generate-from-queue") {
    // Read first pending topic from topic-queue.json, use it
    const q = readJSON(TOPICS_PATH) || [];
    const next = q.find(t => t.status === "pending");
    if (next) {
      script = "generate.mjs";
      args.push(next.title);
      if (next.url) args.push("--url", next.url);
      // Will mark as done after success
      run._topicId = next.id;
    } else {
      run.done = { done: true, success: false, error: "Brak pending tematów w kolejce" };
      return;
    }
  } else if (run.action === "generate-from-research") {
    const srcDb = readJSON(SOURCES_DB_PATH) || [];
    const recent = srcDb.slice(-5);
    if (recent.length) {
      script = "generate.mjs";
      const titles = recent.map(s => s.title).join(" | ");
      args.push(titles.slice(0, 300));
    } else {
      run.done = { done: true, success: false, error: "Brak źródeł w research DB" };
      return;
    }
  } else if (run.action === "generate-from-gap") {
    const gap = readJSON(path.join(ROOT, "gap-report.json"));
    const gaps = gap?.gaps || [];
    const kw = gap?.topKeywords || [];
    const topic = gaps[0]?.keyword || kw[0] || "trendy e-commerce";
    script = "generate.mjs";
    args.push(typeof topic === "string" ? topic : topic.keyword || String(topic));
  } else if (run.action === "process-queue") {
    // Will be handled specially — iterate all pending
    script = null; // custom handling below
  } else if (run.action === "regenerate-index") {
    // Use dynamic import to call shared.mjs functions directly
    (async () => {
      try {
        const shared = await import(pathToFileURL(path.join(ROOT, "lib", "shared.mjs")).href);
        await shared.generateIndex();
        await shared.generateSitemap();
        await shared.generateFeed();
        run.buf = "✅ Index, sitemap i feed zregenerowane\n";
        const doneMsg = { done: true, success: true, output: run.buf };
        if (run.res) sendSSE(run.res, doneMsg);
        run.done = doneMsg;
      } catch (e) {
        run.buf = "❌ " + e.message + "\n";
        const doneMsg = { done: true, success: false, error: e.message, output: run.buf };
        if (run.res) sendSSE(run.res, doneMsg);
        run.done = doneMsg;
      }
    })();
    return;
  } else if (run.action === "auto-watch") {
    script = "rss-watch.mjs";
  } else if (run.action === "review") {
    script = "rss-watch.mjs";
    args.push("--review");
  } else if (run.action === "analyze") {
    script = "analyze.mjs";
  } else if (run.action === "newsletter") {
    script = "newsletter.mjs";
  } else if (run.action === "social") {
    script = "social.mjs";
  }

  // Common settings (per-article overrides take priority over global)
  if (script) args.push("--non-interactive");
  const fmt = body.format || s.format;
  const per = body.persona || s.persona;
  const to = body.tone || s.tone;
  const lng = body.lang || s.lang;
  if (s.agent === false || body.format) {
    if (fmt && fmt !== "article") { args.push("--format", fmt); }
  }
  if (s.agent === false || body.persona) {
    if (per && per !== "journalist") { args.push("--persona", per); }
  }
  if (s.agent === false || body.tone) {
    if (to && to !== "casual") { args.push("--tone", to); }
  }
  if (lng && lng !== "pl") { args.push("--lang", lng); }
  if (s.queries > 0) { args.push("--queries", String(s.queries)); }

  // Push flag (default: on for generate/rss)
  const push = body.push !== undefined ? body.push : true;
  if (push && script) args.push("--push");

  // Auto-watch specific
  if (run.action === "auto-watch") {
    if (s._digest) args.push("--digest");
    if (s._newsletter) args.push("--newsletter");
    if (s._verbose) args.push("--verbose");
  }

  // handle process-queue: spawn multiple generate runs in sequence
  if (run.action === "process-queue") {
    const q = readJSON(TOPICS_PATH) || [];
    const pending = q.filter(t => t.status === "pending");
    if (!pending.length) {
      run.done = { done: true, success: false, error: "Brak pending tematów" };
      return;
    }
    run._queueIndex = 0;
    run._queueItems = pending;
    run._queueTotal = pending.length;
    run.buf = `Przetwarzanie ${pending.length} tematów...\n`;
    spawnQueueItem(run, s, body, args);
    return;
  }

  if (!script) { run.done = { done: true, success: false, error: "unknown action" }; return; }

  args.push("--json-output");
  const child = spawn(process.execPath, [script, ...args], { cwd: ROOT });
  run.proc = child;

  run.buf = "";
  run._lineBuf = "";
  function emit(type, data) {
    run.buf += data;
    run._lineBuf += data;
    const lines = run._lineBuf.split("\n");
    run._lineBuf = lines.pop();
    if (run.res) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Try to parse as JSON event from child process
        try {
          const evt = JSON.parse(trimmed);
          if (evt && typeof evt === 'object' && evt.type) {
            sendSSE(run.res, { type: "event", event: evt });
            continue;
          }
        } catch {}
        // Fallback: raw text
        sendSSE(run.res, { type, data: trimmed + "\n", full: run.buf });
      }
    }
  }
  child.stdout.on("data", d => emit("stdout", d.toString()));
  child.stderr.on("data", d => emit("stderr", d.toString()));
  child.on("exit", code => {
    emit("exit", String(code));
    const ok = code === 0;
    const doneMsg = { done: true, success: ok, error: ok ? null : "exit code " + code, output: run.buf };
    if (run.res) sendSSE(run.res, doneMsg);
    run.done = doneMsg;
    // Mark topic as done after single-queue generation
    if (run._topicId && ok) {
      const q = readJSON(TOPICS_PATH) || [];
      const t = q.find(t => t.id === run._topicId);
      if (t) { t.status = "done"; writeFileSync(TOPICS_PATH, JSON.stringify(q, null, 2)); }
    }
    setTimeout(() => runs.delete(run.id), 60000);
  });
  child.on("error", e => {
    const errMsg = { done: true, success: false, error: e.message, output: run.buf };
    if (run.res) sendSSE(run.res, { type: "error", data: e.message });
    if (run.res) sendSSE(run.res, errMsg);
    run.done = errMsg;
  });
}

function spawnQueueItem(run, s, body, baseArgs) {
  if (run._queueIndex >= run._queueItems.length) {
    const doneMsg = { done: true, success: true, output: run.buf + `\n✅ Przetworzono ${run._queueTotal} tematów\n` };
    if (run.res) sendSSE(run.res, doneMsg);
    run.done = doneMsg;
    setTimeout(() => runs.delete(run.id), 60000);
    return;
  }
  const item = run._queueItems[run._queueIndex];
  run._queueIndex++;
  const preview = item.title.slice(0, 60);
  run.buf += `[${run._queueIndex}/${run._queueTotal}] ${preview}\n`;
  if (run.res) sendSSE(run.res, { type: "stdout", data: `[${run._queueIndex}/${run._queueTotal}] ${preview}\n`, full: run.buf });

  const fmt = body.format || s.format;
  const per = body.persona || s.persona;
  const to = body.tone || s.tone;
  const lng = body.lang || s.lang;
  const sArgs = [item.title, "--non-interactive"];
  if (item.url) sArgs.push("--url", item.url);
  if (fmt && fmt !== "article") sArgs.push("--format", fmt);
  if (per && per !== "journalist") sArgs.push("--persona", per);
  if (to && to !== "casual") sArgs.push("--tone", to);
  if (lng && lng !== "pl") sArgs.push("--lang", lng);
  if (body.push !== false) sArgs.push("--push");
  sArgs.push("--json-output");

  const child = spawn(process.execPath, ["generate.mjs", ...sArgs], { cwd: ROOT });
  child.stdout.on("data", d => {
    run.buf += d.toString();
    if (run.res) sendSSE(run.res, { type: "stdout", data: d.toString(), full: run.buf });
  });
  child.stderr.on("data", d => {
    run.buf += d.toString();
    if (run.res) sendSSE(run.res, { type: "stderr", data: d.toString(), full: run.buf });
  });
  child.on("exit", code => {
    const ok = code === 0;
    if (ok) {
      const q = readJSON(TOPICS_PATH) || [];
      const t = q.find(t => t.id === item.id);
      if (t) { t.status = "done"; writeFileSync(TOPICS_PATH, JSON.stringify(q, null, 2)); }
    }
    run.buf += `  ${ok ? '✅' : '❌'} ${ok ? 'OK' : 'exit '+code}\n`;
    spawnQueueItem(run, s, body, baseArgs);
  });
  child.on("error", e => {
    run.buf += `  ❌ ${e.message}\n`;
    spawnQueueItem(run, s, body, baseArgs);
  });
}

const NB_RUNNER = path.join(ROOT, "engines", "nb_runner.py");
const NB_PY = "python";

function spawnNbRun(run) {
  let body = {};
  try { if (run.body) body = JSON.parse(run.body); } catch {}
  const nbAction = body.action || "list";
  const nbArgs = body.args || [];
  const cmd = `"${NB_PY}" "${NB_RUNNER}" ${nbAction} ${nbArgs.map(a => `"${String(a).replace(/"/g,'\\"')}"`).join(" ")}`;
  const child = exec(cmd, { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 });
  run.proc = child;
  run.buf = "";
  function emit(type, data) {
    run.buf += data;
    if (run.res) sendSSE(run.res, { type, data, full: run.buf });
  }
  child.stdout.on("data", d => emit("stdout", d.toString()));
  child.stderr.on("data", d => emit("stderr", d.toString()));
  // Heartbeat every 10s to keep SSE alive and show progress
  const hb = setInterval(() => { if (run.res) sendSSE(run.res, { type: "heartbeat", data: "\n" }); }, 10000);
  child.on("exit", code => {
    clearInterval(hb);
    emit("exit", String(code));
    const ok = code === 0;
    const doneMsg = { done: true, success: ok, error: ok ? null : "exit code " + code, output: run.buf };
    if (run.res) sendSSE(run.res, doneMsg);
    run.done = doneMsg;
    setTimeout(() => runs.delete(run.id), 60000);
  });
  child.on("error", e => {
    clearInterval(hb);
    const errMsg = { done: true, success: false, error: e.message, output: run.buf };
    if (run.res) sendSSE(run.res, { type: "error", data: e.message });
    if (run.res) sendSSE(run.res, errMsg);
    run.done = errMsg;
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const m = req.method;
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (m === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── NotebookLM exec (moved before all handlers to avoid ReferenceError) ──
  const NB = path.join(ROOT, "engines", "nb_runner.py");
  const PY = "python";
  function nbExec(...args) {
    let timeout = 30000;
    if (args[0] === "generate-report" || args[0] === "add-research") timeout = 300000;
    else if (args[0] === "generate-audio") timeout = 600000;
    else if (args[0] === "ask") timeout = 180000;
    try {
      const out = execSync(`"${PY}" "${NB}" ${args.map(a => `"${String(a).replace(/"/g,'\\"')}"`).join(" ")}`, { encoding: "utf8", timeout, cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
      return JSON.parse(out.trim());
    } catch (e) {
      let msg = e.message;
      try { if (e.stderr) { const j = JSON.parse(e.stderr.trim()); msg = j.error || msg; } } catch {}
      throw new Error(msg);
    }
  }

  // SSE stream endpoint
  if (m === "GET" && p.startsWith("/api/run/") && p.endsWith("/stream")) {
    const runId = p.split("/")[3];
    const run = runs.get(runId);
    if (!run) { json(res, { error: "not found" }, 404); return; }
    sseHeaders(res);
    run.res = res;
    req.on("close", () => { run.res = null; });
    // Replay buffer if process already running or finished
    if (run.buf) sendSSE(res, { type: "stdout", data: run.buf, full: run.buf });
    if (run.done) sendSSE(res, run.done);
    return;
  }

  // POST /api/run/:runId/cancel
  if (m === "POST" && /^\/api\/run\/[a-f0-9]+\/cancel$/.test(p)) {
    const runId = p.split("/")[3];
    const run = runs.get(runId);
    if (run && run.proc) {
      run.proc.kill("SIGTERM");
      setTimeout(() => { try { run.proc.kill("SIGKILL"); } catch {} }, 3000);
      json(res, { ok: true });
    } else {
      json(res, { error: "not found" }, 404);
    }
    return;
  }

  // POST /api/run/nb — stream NotebookLM CLI output with live progress
  if (m === "POST" && p === "/api/run/nb") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        if (!b.action) { json(res, { error: "missing action" }, 400); return; }
        const runId = uid();
        const run = { id: runId, action: "nb-run", res: null, buf: "", body };
        runs.set(runId, run);
        json(res, { ok: true, runId }, 202);
        spawnNbRun(run);
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // POST /api/run/nb-newsletter-report
  if (m === "POST" && p === "/api/run/nb-newsletter-report") {
    try {
      const result = nbExec("generate-report", "5dd3bcd8-fc51-481e-bffa-fab231a378c3", "--format", "briefing-doc");
      json(res, { ok: true, output: JSON.stringify(result, null, 2) });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/run/nb-newsletter-audio
  if (m === "POST" && p === "/api/run/nb-newsletter-audio") {
    try {
      const result = nbExec("generate-audio", "992ecd72-5758-4a43-9b8e-cfaf7bf0bd72", "--format", "deep-dive");
      json(res, { ok: true, output: JSON.stringify(result, null, 2) });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/run/:action
  if (m === "POST" && p !== "/api/run/nb" && /^\/api\/run\/[a-z][a-z-]+$/.test(p)) {
    const action = p.replace("/api/run/", "");
    const VALID = ["generate","rss","auto-watch","review","analyze","newsletter","social","generate-from-queue","generate-from-research","generate-from-gap","process-queue","regenerate-index"];
    if (!VALID.includes(action)) { json(res, { ok: false, error: "unknown action" }, 400); return; }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const runId = uid();
      const run = { id: runId, action, res: null, buf: "", body };
      runs.set(runId, run);
      json(res, { ok: true, runId }, 202);
      spawnRun(run);
    });
    return;
  }

  // POST /api/push — git commit + push (np. po wygenerowaniu artykułu)
  if (m === "POST" && p === "/api/push") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body); } catch {}
      const files = (b.files || "articles/ generated.json").trim();
      const msg = (b.message || "Update").replace(/"/g, "\\\"");
      try {
        execSync(`git add ${files}`, { cwd: ROOT, encoding: "utf8" });
        execSync(`git commit -m "${msg}"`, { cwd: ROOT, encoding: "utf8" });
        execSync(`git push`, { cwd: ROOT, encoding: "utf8" });
        json(res, { ok: true, message: "Pushnięte" });
      } catch (e) {
        const err = e.stderr?.toString().slice(0, 300) || e.message;
        json(res, { ok: false, error: err }, 500);
      }
    });
    return;
  }

  // GET /api/settings
  if (m === "GET" && p === "/api/settings") {
    const s = readJSON(path.join(ROOT, "settings.json")) || {};
    json(res, s);
    return;
  }

  // POST /api/settings
  if (m === "POST" && p === "/api/settings") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const s = JSON.parse(body);
        writeFileSync(path.join(ROOT, "settings.json"), JSON.stringify(s, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // GET /api/models
  if (m === "GET" && p === "/api/models") {
    (async () => {
      try {
        const shared = await import(pathToFileURL(path.join(ROOT, "lib", "shared.mjs")).href);
        json(res, await shared.listModels());
      } catch (e) { json(res, [], 500); }
    })();
    return;
  }

  // GET /api/status
  if (m === "GET" && p === "/api/status") {
    (async () => {
      try {
        const shared = await import(pathToFileURL(path.join(ROOT, "lib", "shared.mjs")).href);
        const models = await shared.listModels();
        json(res, { provider: "nvidia", model: shared.DEFAULT_MODEL, models, configured: !!shared.nvidiaKey() });
      } catch (e) { json(res, { provider: "nvidia", models: [], configured: false }); }
    })();
    return;
  }

  // GET /api/nb/auth-status — uses doctor to validate real session, not cached list
  if (m === "GET" && p === "/api/nb/auth-status") {
    try {
      const diag = nbExec("doctor");
      const listR = nbExec("list");
      const nbs = Array.isArray(listR) ? listR : (listR.notebooks || []);
      json(res, { auth: true, notebooks: nbs.length, detail: diag });
    } catch (e) {
      json(res, { auth: false, error: e.message || "Sesja wygasła" }, 503);
    }
    return;
  }

  // POST /api/nb/login
  if (m === "POST" && p === "/api/nb/login") {
    try { json(res, nbExec("login")); }
    catch (e) { json(res, { ok: false, error: e.message }, 500); }
    return;
  }

  // POST /api/nb/logout
  if (m === "POST" && p === "/api/nb/logout") {
    try { json(res, nbExec("logout")); }
    catch (e) { json(res, { ok: false, error: e.message }, 500); }
    return;
  }

  // GET /api/nb/status
  if (m === "GET" && p === "/api/nb/status") {
    try { json(res, nbExec("status")); }
    catch (e) { json(res, { auth: false, error: e.message }, 503); }
    return;
  }

  // GET /api/nb/notebooks
  if (m === "GET" && p === "/api/nb/notebooks") {
    try { json(res, nbExec("list")); }
    catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/create
  if (m === "POST" && p === "/api/nb/create") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        json(res, nbExec("create", b.name || "SmartBuyers Notebook"));
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // POST /api/nb/init-context — returns systemprompt.md content for prepending to queries
  if (m === "POST" && p === "/api/nb/init-context") {
    try {
      const spFile = path.join(ROOT, "systemprompt.md");
      if (!existsSync(spFile)) { json(res, { error: "not found" }, 404); return; }
      const content = readFileSync(spFile, "utf8");
      const maxLen = 4000;
      const trimmed = content.length > maxLen ? content.slice(0, maxLen) : content;
      json(res, { ok: true, content: trimmed });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/add-research
  if (m === "POST" && p === "/api/nb/add-research") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const mode = b.mode || "fast";
        const result = nbExec("add-research", b.notebookId, b.query, "--mode", mode);
        json(res, result);
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // POST /api/nb/generate-report
  if (m === "POST" && p === "/api/nb/generate-report") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const result = nbExec("generate-report", b.notebookId, "--format", b.format || "briefing-doc");
        json(res, result);
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // POST /api/nb/generate-audio
  if (m === "POST" && p === "/api/nb/generate-audio") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const result = nbExec("generate-audio", b.notebookId, "--format", b.format || "deep-dive");
        json(res, result);
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // GET /api/nb/notebooks/:id/summary
  if (m === "GET" && p.startsWith("/api/nb/notebooks/") && p.endsWith("/summary")) {
    try {
      const id = p.replace("/api/nb/notebooks/", "").replace("/summary", "");
      json(res, nbExec("notebook-summary", id));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/nb/notebooks/:id/sources
  if (m === "GET" && p.startsWith("/api/nb/notebooks/") && p.endsWith("/sources")) {
    try {
      const id = p.replace("/api/nb/notebooks/", "").replace("/sources", "");
      json(res, nbExec("sources", id));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/nb/notebooks/:id/artifacts
  if (m === "GET" && p.startsWith("/api/nb/notebooks/") && p.endsWith("/artifacts")) {
    try {
      const id = p.replace("/api/nb/notebooks/", "").replace("/artifacts", "");
      json(res, nbExec("artifact-list", id));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/nb/notebooks/:id/metadata
  if (m === "GET" && p.startsWith("/api/nb/notebooks/") && p.endsWith("/metadata")) {
    try {
      const id = p.replace("/api/nb/notebooks/", "").replace("/metadata", "");
      json(res, nbExec("metadata", id));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/source-add
  if (m === "POST" && p === "/api/nb/source-add") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const type = b.type || "auto";
        json(res, nbExec("source-add", b.notebookId, b.content, "--type", type));
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // POST /api/nb/source-guide
  if (m === "POST" && p === "/api/nb/source-guide") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        json(res, nbExec("source-guide", b.notebookId, b.sourceId));
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // POST /api/nb/rename
  if (m === "POST" && p === "/api/nb/rename") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        json(res, nbExec("rename", b.notebookId, b.title));
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // DELETE /api/nb/notebooks/:id
  if (m === "DELETE" && /^\/api\/nb\/notebooks\/[a-f0-9]+\/?$/.test(p)) {
    try {
      const id = p.replace("/api/nb/notebooks/", "").replace("/", "");
      json(res, nbExec("delete", id));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/ask
  if (m === "POST" && p === "/api/nb/ask") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        json(res, nbExec("ask", b.notebookId, b.question));
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // GET /api/nb/telemetry
  if (m === "GET" && p === "/api/nb/telemetry") {
    try {
      const nbList = nbExec("list");
      const nbs = Array.isArray(nbList) ? nbList : (nbList.notebooks || []);
      let totalSources = 0;
      for (const nb of nbs) {
        try {
          const src = nbExec("sources", nb.id);
          totalSources += (src.sources || []).length;
        } catch {}
      }
      json(res, { notebooks: nbs.length, totalSources });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/telemetry/competitors
  if (m === "GET" && p === "/api/telemetry/competitors") {
    try {
      const comp = readJSON(path.join(ROOT, "competitors.json")) || [];
      json(res, { total: comp.length, items: comp });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/telemetry/analyze-summary
  if (m === "GET" && p === "/api/telemetry/analyze-summary") {
    try {
      const gen = readJSON(path.join(ROOT, "generated.json")) || {};
      const articles = Object.values(gen);
      const gap = readJSON(path.join(ROOT, "gap-report.json")) || {};
      const dates = articles.map(a => a.date).filter(Boolean).sort();
      const allTitles = articles.map(a => a.slug || "").join(" ");
      const uniqueWords = [...new Set(allTitles.split(/[\s\-]+/).filter(w => w.length > 2))].length;
      json(res, {
        articleCount: articles.length,
        oldestDate: dates[0] || null,
        newestDate: dates[dates.length - 1] || null,
        uniqueWords,
        gapCount: gap.gapCount || 0,
        keywordCount: (gap.topKeywords || []).length,
      });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/queries
  if (m === "GET" && p === "/api/queries") {
    try {
      const q = readJSON(path.join(ROOT, "queries.json")) || { pool: [] };
      json(res, q);
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/queries
  if (m === "POST" && p === "/api/queries") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        writeFileSync(path.join(ROOT, "queries.json"), JSON.stringify(b, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // GET /api/git-status
  if (m === "GET" && p === "/api/git-status") {
    try {
      const log = execSync("git log --oneline -5", { encoding: "utf8", timeout: 5000, cwd: ROOT }).trim();
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", timeout: 5000, cwd: ROOT }).trim();
      const lastCommit = log.split("\n")[0] || "";
      const googleKey = !!process.env.GOOGLE_INDEXING_KEY;
      const linkedinToken = !!process.env.LINKEDIN_TOKEN;
      json(res, { branch, lastCommit, recentCommits: log.split("\n"), googleIndexing: googleKey, linkedin: linkedinToken });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/tokens
  if (m === "GET" && p === "/api/tokens") {
    try {
      const nbStatus = nbExec("status");
      const nbCount = nbStatus.notebooks || 0;
      const recentRuns = Array.from(runs.values()).filter(r => r.buf && r.buf.length > 0).length;
      json(res, {
        ollamaModels: (() => { try { return process.env.NVIDIA_API_KEY ? 1 : 0; } catch { return 0; } })(),
        nbNotebooks: nbCount,
        activeRuns: recentRuns,
        generatedTotal: Object.keys(readJSON(path.join(ROOT, "generated.json")) || {}).length,
      });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/downloads
  if (m === "POST" && p === "/api/nb/downloads") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const nbId = b.notebookId || "7a31df6c";
        const type = b.type || "all";
        const result = nbExec("artifact-list", nbId, "--type", type);
        const artifacts = result.artifacts || result || [];
        const items = Array.isArray(artifacts) ? artifacts.map(a => ({
          id: a.id,
          title: a.title || a.id,
          type: a.type || "unknown",
          created_at: a.created_at || "",
        })) : [];
        json(res, { total: items.length, items });
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // POST /api/nb/download
  if (m === "POST" && p === "/api/nb/download") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const args = ["download", b.type || "report", "-n", b.notebookId];
        if (b.artifactId) args.push(b.artifactId);
        if (b.outputPath) args.push("--output", b.outputPath);
        const result = nbExec(...args);
        json(res, { ok: true, output: JSON.stringify(result, null, 2) });
      } catch (e) { json(res, { error: e.message }, 500); }
    });
    return;
  }

  // GET /api/nb/config
  if (m === "GET" && p === "/api/nb/config") {
    try {
      const cfg = readJSON(path.join(ROOT, "nb-config.json")) || {
        defaultNotebook: "research",
        audioStyle: "deep-dive",
        videoStyle: "whiteboard",
        autoPushSources: true,
        autoGenerateReport: false,
      };
      json(res, cfg);
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // POST /api/nb/config
  if (m === "POST" && p === "/api/nb/config") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        writeFileSync(path.join(ROOT, "nb-config.json"), JSON.stringify(b, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // GET /api/warmup — check NVIDIA API connectivity (SSE via EventSource)
  if (m === "GET" && p === "/api/warmup") {
    (async () => {
      const shared = await import(pathToFileURL(path.join(ROOT, "lib", "shared.mjs")).href);
      const model = (() => { try { const s = readJSON(path.join(ROOT, "settings.json")); return s.model || shared.DEFAULT_MODEL; } catch { return shared.DEFAULT_MODEL; } })();
      sseHeaders(res);
      sendSSE(res, { type: "step", step: "warmup_start", data: `Sprawdzanie NVIDIA API (${model})...\n` });
      const start = Date.now();
      try {
        const wup = await fetch(shared.chatUrl(), {
          method: "POST", headers: shared.chatHeaders(),
          body: JSON.stringify({ model, messages: [{ role: "user", content: "OK" }], max_tokens: 1 }),
        });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (wup.ok) {
          sendSSE(res, { done: true, success: true, step: "warmup_done", data: `✅ Połączono! ${elapsed}s | ${model}\n`, output: `✅ NVIDIA API OK (${model}) w ${elapsed}s` });
        } else {
          const errTxt = await wup.text().catch(() => "");
          sendSSE(res, { done: true, success: false, step: "warmup_error", data: `❌ HTTP ${wup.status}: ${errTxt.slice(0, 120)}\n`, error: `HTTP ${wup.status}` });
        }
      } catch (e) {
        sendSSE(res, { done: true, success: false, step: "warmup_error", data: `❌ ${e.message}\n`, error: e.message });
      }
    })();
    return;
  }

  // GET /api/articles — list all generated articles with content snippets
  if (m === "GET" && p === "/api/articles") {
    try {
      const gen = readJSON(path.join(ROOT, "generated.json")) || {};
      const seen = new Set();
      const articles = [];
      for (const [k, v] of Object.entries(gen)) {
        const slug = v.slug || "";
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const filePath = `articles/${slug}.html`;
        let snippet = "";
        try {
          const html = readFileSync(path.join(ROOT, filePath), "utf8");
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&[a-z]+;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
          snippet = text.substring(0, 280);
        } catch {}
        articles.push({
          slug: slug,
          title: v.title || slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          date: v.date || "",
          source: v.source || "",
          sourceUrl: k || "",
          format: v.format || "article",
          persona: v.persona || "",
          tone: v.tone || "",
          model: v.model || "nvidia/llama-3.3-nemotron-super-49b-v1",
          words: v.words || 0,
          size: v.size || "",
          file: filePath,
          snippet,
        });
      }
      articles.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      json(res, { total: articles.length, articles });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/telemetry
  if (m === "GET" && p === "/api/telemetry") {
    try {
      const gen = readJSON(path.join(ROOT, "generated.json")) || {};
      const articles = Object.entries(gen).filter(([k]) => k.includes("/articles/"));
      const byMonth = {};
      let lastDate = null;
      articles.forEach(([k, v]) => {
        const d = v.date || "";
        const m = d.slice(0, 7);
        if (m) byMonth[m] = (byMonth[m] || 0) + 1;
        if (d && (!lastDate || d > lastDate)) lastDate = d;
      });
      const feeds = readJSON(path.join(ROOT, "feeds.json")) || [];
      const byMode = {};
      feeds.forEach(f => { byMode[f.mode || "generate"] = (byMode[f.mode || "generate"] || 0) + 1; });
      const comp = readJSON(path.join(ROOT, "competitors.json")) || [];
      const gap = readJSON(path.join(ROOT, "gap-report.json")) || {};
      json(res, {
        articles: { total: articles.length, lastDate, byMonth },
        feeds: { total: feeds.length, byMode },
        competitors: { total: comp.length },
        gaps: { gapCount: gap.gapCount || 0, topKeywords: gap.topKeywords || [] },
        runs: Array.from(runs.values()).map(r => ({
          action: r.action, success: null, elapsed: null,
          bodyLen: (r.buf || "").length,
          date: new Date().toISOString(),
        })),
      });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/feeds — list all RSS feeds
  if (m === "GET" && p === "/api/feeds") {
    try {
      const feeds = readJSON(path.join(ROOT, "feeds.json")) || [];
      json(res, { feeds });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // GET /api/rss/parse?url=... — fetch RSS feed items without Ollama
  if (m === "GET" && p === "/api/rss/parse") {
    const feedUrl = url.searchParams.get("url");
    if (!feedUrl) { json(res, { error: "missing url" }, 400); return; }
    (async () => {
      try {
        const feed = await rssParser.parseURL(feedUrl);
        const items = (feed.items || []).map(item => ({
          title: item.title || "",
          link: item.link || "",
          pubDate: item.pubDate || item.isoDate || "",
          contentSnippet: (item.contentSnippet || item.content || "").slice(0, 300),
          guid: item.guid || item.link || "",
        }));
        json(res, { feed: { title: feed.title || "", description: feed.description || "" }, items });
      } catch (e) { json(res, { error: e.message }, 500); }
    })();
    return;
  }

  // Topic queue CRUD
  if (m === "GET" && p === "/api/topics") {
    json(res, { topics });
    return;
  }

  if (m === "POST" && p === "/api/topics") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        if (!b.title) { json(res, { error: "missing title" }, 400); return; }
        const topic = {
          id: uid(), title: b.title, url: b.url || "", source: b.source || "",
          guid: b.guid || "", date: new Date().toISOString(), status: "pending",
        };
        topics.push(topic);
        saveTopics();
        json(res, { ok: true, topic });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  if (m === "DELETE" && p.startsWith("/api/topics/")) {
    const id = p.split("/")[3];
    const idx = topics.findIndex(t => t.id === id);
    if (idx === -1) { json(res, { error: "not found" }, 404); return; }
    topics.splice(idx, 1);
    saveTopics();
    json(res, { ok: true });
    return;
  }

  if (m === "PATCH" && p.startsWith("/api/topics/")) {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const id = p.split("/")[3];
        const t = topics.find(t => t.id === id);
        if (!t) { json(res, { error: "not found" }, 404); return; }
        if (b.status) t.status = b.status;
        if (b.title) t.title = b.title;
        saveTopics();
        json(res, { ok: true, topic: t });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // Research sources DB — CRUD
  if (m === "GET" && p === "/api/research-sources") {
    const cat = url.searchParams.get("category");
    const list = cat ? sourcesDb.filter(s => s.category === cat) : sourcesDb;
    json(res, { sources: list, total: list.length, categories: [...new Set(sourcesDb.map(s => s.category).filter(Boolean))] });
    return;
  }

  if (m === "POST" && p === "/api/research-sources") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        if (!b.url) { json(res, { error: "missing url" }, 400); return; }
        // Deduplicate by URL
        const exists = sourcesDb.find(s => s.url === b.url);
        if (exists) { json(res, { ok: true, source: exists, deduped: true }); return; }
        const src = {
          id: uid(), url: b.url, title: b.title || "", researchQuery: b.researchQuery || "",
          researchId: b.researchId || "", category: b.category || "general",
          date: new Date().toISOString(), status: "new",
        };
        sourcesDb.push(src);
        saveSourcesDb();
        json(res, { ok: true, source: src });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  if (m === "PATCH" && p.startsWith("/api/research-sources/")) {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        const id = p.split("/")[3];
        const s = sourcesDb.find(s => s.id === id);
        if (!s) { json(res, { error: "not found" }, 404); return; }
        if (b.status) s.status = b.status;
        if (b.category) s.category = b.category;
        saveSourcesDb();
        json(res, { ok: true, source: s });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // Research results log — CRUD
  if (m === "GET" && p === "/api/research-results") {
    json(res, { results: researchLog });
    return;
  }

  if (m === "POST" && p === "/api/research-results") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        if (!b.query) { json(res, { error: "missing query" }, 400); return; }
        const entry = {
          id: uid(), query: b.query, date: new Date().toISOString(),
          output: b.output || "", category: b.category || "",
        };
        researchLog.unshift(entry);
        if (researchLog.length > 50) researchLog.length = 50;
        saveResearch();
        // Auto-parse sources from research output JSON
        let sourcesAdded = 0;
        const cat = b.category || "general";
        try {
          const parsed = JSON.parse(b.output.trim());
          const sources = parsed.sources || parsed.items || [];
          sources.forEach(s => {
            const url = s.url || s.link || "";
            const title = s.title || s.name || url;
            if (url && !sourcesDb.find(x => x.url === url)) {
              sourcesDb.push({ id: uid(), url, title, researchQuery: b.query, researchId: entry.id, category: cat, date: new Date().toISOString(), status: "new" });
              sourcesAdded++;
            }
          });
          if (sourcesAdded) saveSourcesDb();
        } catch {}
        json(res, { ok: true, entry, sourcesAdded });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  // Static article files from root/articles
  if (m === "GET" && p.startsWith("/articles/") && p.endsWith(".html")) {
    const afp = path.join(ROOT, p.replace(/^\//, ""));
    try {
      const c = readFileSync(afp);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(c);
    } catch { json(res, { error: "article not found" }, 404); }
    return;
  }

  // Static files
  const file = p === "/" ? "/index.html" : p;
  const fp = path.join(PUBLIC, file);
  try {
    const c = readFileSync(fp);
    const ext = path.extname(fp);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(c);
  } catch { json(res, { error: "not found" }, 404); }
});

server.listen(PORT, () => {
  console.log(`\n  🧠 SmartBuyers Tile UI: http://localhost:${PORT}\n`);
});
