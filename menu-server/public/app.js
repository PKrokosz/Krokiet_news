/* ===========================
   SmartBuyers v3 — App Logic
   =========================== */

(function() {
  'use strict';

  // --- Dicts (matching server-side labels) ---
  const FORMAT_OPTS = { article:'Standard', list:'Top lista', howto:'Poradnik', explainer:'Czym jest X', vs:'Porównanie', myth:'Mit czy fakt', faq:'FAQ', digest:'Przegląd', opinion:'Opinia' };
  const PERSONA_OPTS = { journalist:'Dziennikarz', marketer:'Marketer', technical:'Technical Writer', ceo:'CEO/Founder', customer:'Klient' };
  const TONE_OPTS = { casual:'Swobodny', formal:'Formalny', educational:'Edukacyjny', urgent:'Pilny' };
  const LANG_OPTS = { pl:'Polski', en:'English' };
  const RESEARCH_CATEGORIES = {
    ecommerce:    { icon:'🛒', label:'E-Commerce & Marketplace' },
    'supply-chain':{ icon:'🚚', label:'Supply Chain & Logistyka' },
    marketing:    { icon:'📢', label:'Marketing & AI' },
    regulations:  { icon:'⚖️', label:'Regulacje EU' },
    general:      { icon:'📊', label:'Ogólne' },
  };
  const NB_NOTEBOOKS = {
    sandbox: { id:'ab97b6a3-2d3f-4d90-a606-6e9f2d3417ec', title:'Sandbox', icon:'🧪', desc:'Notebook testowy' },
    news: { id:'5dd3bcd8-fc51-481e-bffa-fab231a378c3', title:'News Digest', icon:'📰', desc:'Digest z kanałów RSS' },
    research: { id:'7a31df6c-2516-4a0a-a0a6-34403d15f10a', title:'Deep Research', icon:'🔬', desc:'Badania tematyczne' },
    audio: { id:'992ecd72-5758-4a43-9b8e-cfaf7bf0bd72', title:'Audio Studio', icon:'🎙️', desc:'Podcasty i audio' },
    sources: { id:'9ebb1726-9322-423e-92f4-b081d65218b5', title:'Sources', icon:'📚', desc:'Źródła i materiały' },
    ads: { id:'7410e5aa-7a83-4bc4-95d3-69bff35074f0', title:'Competition', icon:'🏁', desc:'Analiza konkurencji' },
  };
  const ACTION_LABELS = {
    'generate-prompt':'Generowanie prompta','generate-feed':'Generowanie feeda','generate-rss':'Generowanie z RSS',
    'rss-check':'Sprawdzanie RSS','rss-images':'Generowanie obrazków','rss-feed':'Generowanie feeda RSS',
    'auto-watch':'Auto-watch','review':'Przegląd','review-fail':'Przegląd (fail)','analyze':'Analiza',
    'newsletter':'Generowanie newslettera','send-newsletter':'Wysyłanie newslettera',
    'warmup':'Warmup NVIDIA',
  };

  // --- State ---
  let navStack = [{ level: 'home' }];
  let settingsCache = {};
  let modelsList = [];
  let running = null; // { es, runId, tileAction, output, _progressTimer }
  let jobHistory = []; // [{ action, label, status, time, output }]
  let nbAuthed = false; // NotebookLM auth state

  // --- DOM refs ---
  const $ = s => document.querySelector(s);
  const tilesEl = $('#tiles');
  const breadcrumbEl = $('#breadcrumb');
  const pageTitle = $('#pageTitle');
  const pageSub = $('#pageSub');
  const headerModel = $('#headerModel');
  const headerInfo = $('#headerInfo');
  const headerStatus = $('#headerStatus');
  const headerNbStatus = $('#headerNbStatus');
  const dialog = $('#dialog');
  const dialogOverlay = $('#dialogOverlay');
  const dialogTitle = $('#dialogTitle');
  const dialogBody = $('#dialogBody');
  const dialogActions = $('#dialogActions');
  const toast = $('#toast');
  const preloader = $('#preloader');
  const cursorDot = $('#cursorDot');
  const cursorRing = $('#cursorRing');

  // ===========================
  // Nav engine
  // ===========================
  function pushLevel(level) {
    if (running && level.level !== 'progress') { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
    navStack.push(level); render();
  }
  function popLevel() {
    if (running) { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
    if (navStack.length > 1) { navStack.pop(); render(); }
  }
  function currentLevel() { return navStack[navStack.length - 1]; }

  // ===========================
  // Breadcrumb labels
  // ===========================
  const LEVEL_META = {
    home: { title: 'Dashboard', sub: 'Panel sterowania treścią' },
    generuj: { title: 'Generuj', sub: 'Generowanie treści' },
    rss: { title: 'RSS', sub: 'Zarządzanie kanałami RSS' },
    'auto-watch': { title: 'Auto-watch', sub: 'Automatyczny monitoring' },
    review: { title: 'Przegląd', sub: 'Przegląd i korekta' },
    analyze: { title: 'Analiza', sub: 'Analiza treści' },
    newsletter: { title: 'Publikuj i analizuj', sub: 'Newsletter · NotebookLM · Analiza · Git' },
    settings: { title: 'Ustawienia', sub: 'Konfiguracja' },
    telemetry: { title: 'Telemetria', sub: 'Statystyki i dane' },
    notebooklm: { title: 'NotebookLM', sub: 'Studio NotebookLM' },
    'nb-sources': { title: 'Sources', sub: 'Dodawanie i zarządzanie źródłami' },
    'nb-studio': { title: 'Studio', sub: 'Generowanie treści z NotebookLM' },
    'nb-insights': { title: 'Insights', sub: 'Analiza i badania NotebookLM' },
    'notebooklm-list': { title: 'Notebooki', sub: 'Lista wszystkich notebooków' },
    competitors: { title: 'Konkurencja', sub: 'Analiza konkurencji' },
    'competitors-detail': { title: 'Artykuły konkurencji', sub: 'Pełna lista' },
    gaps: { title: 'Luki tematyczne', sub: 'Szczegóły luk' },
    'analyze-summary': { title: 'Podsumowanie analizy', sub: 'Metryki i statystyki' },
    'token-usage': { title: 'Tokeny i zużycie', sub: 'Statystyki użycia' },
    'queries-editor': { title: 'Zapytania Google News', sub: 'Edycja puli zapytań' },
    'downloads': { title: 'Pobieranie', sub: 'Artifacty do pobrania' },
    'nb-config': { title: 'NB Config', sub: 'Konfiguracja NotebookLM' },
    'git-status': { title: 'Git / Deploy', sub: 'Status repozytorium' },
    articles: { title: 'Artykuły', sub: 'Przegląd wygenerowanych artykułów' },
    'rss-browse': { title: 'Przeglądaj RSS', sub: 'Wpisy z feeda' },
    'rss-feed-picker-gen': { title: 'Generuj z RSS', sub: 'Wybierz feed — automatycznie wygeneruje artykuł' },
    'research-history': { title: 'Historia researchu', sub: 'Zapisane wyniki badań NotebookLM' },
    'research-sources-db': { title: 'Baza źródeł', sub: 'Linki z researchów z kategoriami' },
    progress: { title: 'W trakcie...', sub: 'Trwa wykonywanie zadania' },
  };
  function levelMeta(lvl) {
    if (lvl.level === 'pickers') {
      const names = { model:'Model', format:'Format', persona:'Persona', tone:'Ton', lang:'Język' };
      return { title: names[lvl.picker] || lvl.picker, sub: 'Wybierz wartość' };
    }
    if (lvl.level === 'result') return { title: 'Wynik', sub: null };
    if (lvl.level === 'nb-category') {
      const nb = NB_NOTEBOOKS[lvl.notebookKey];
      return { title: nb ? nb.title : 'Notebook', sub: nb ? nb.desc : null };
    }
    return LEVEL_META[lvl.level] || { title: lvl.level, sub: null };
  }

  // ===========================
  // Render
  // ===========================
  function render() {
    renderBreadcrumb();
    renderContent();
  }

  function renderBreadcrumb() {
    if (navStack.length <= 1) {
      breadcrumbEl.classList.remove('show');
      return;
    }
    breadcrumbEl.classList.add('show');
    const items = navStack.map((lvl, i) => {
      const meta = levelMeta(lvl);
      const isLast = i === navStack.length - 1;
      return `<span class="breadcrumb-item${isLast ? ' active' : ''}" data-idx="${i}">${meta.title}</span>${isLast ? '' : '<span class="breadcrumb-sep">›</span>'}`;
    }).join('');
    breadcrumbEl.innerHTML = items;
    // clickable breadcrumb items
    breadcrumbEl.querySelectorAll('.breadcrumb-item:not(.active)').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        if (running) { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
        navStack = navStack.slice(0, idx + 1);
        render();
      });
    });
  }

  function renderContent() {
    const lvl = currentLevel();
    const meta = levelMeta(lvl);
    pageTitle.textContent = meta.title;
    if (pageSub) {
      if (meta.sub) { pageSub.textContent = meta.sub; pageSub.classList.remove('hidden'); }
      else { pageSub.classList.add('hidden'); }
    }
    if (lvl.level === 'home') renderHome();
    else if (lvl.level === 'generuj' || lvl.level === 'rss' || lvl.level === 'review' || lvl.level === 'analyze' || lvl.level === 'newsletter') renderActionLevel(lvl.level);
    else if (lvl.level === 'auto-watch') renderAutoWatch();
    else if (lvl.level === 'rss-browse') renderRssBrowse(lvl);
    else if (lvl.level === 'rss-feed-picker') renderRssFeedPicker();
    else if (lvl.level === 'rss-feed-picker-gen') renderRssFeedPickerGen();
    else if (lvl.level === 'topic-queue') renderTopicQueue();
    else if (lvl.level === 'research-history') renderResearchHistory();
    else if (lvl.level === 'research-sources-db') renderSourcesDB();
    else if (lvl.level === 'settings') renderSettings();
    else if (lvl.level === 'pickers') renderPickers(lvl);
    else if (lvl.level === 'result') renderResult(lvl.data);
    else if (lvl.level === 'telemetry') renderTelemetry();
    else if (lvl.level === 'notebooklm') renderNotebooklm();
    else if (lvl.level === 'nb-sources') renderNbSources();
    else if (lvl.level === 'nb-studio') renderNbStudio();
    else if (lvl.level === 'nb-insights') renderNbInsights();
    else if (lvl.level === 'notebooklm-list') renderNotebooklmList();
    else if (lvl.level === 'nb-category') renderNbCategory(lvl);
    else if (lvl.level === 'competitors') renderCompetitors();
    else if (lvl.level === 'competitors-detail') renderCompetitorsDetail();
    else if (lvl.level === 'gaps') renderGaps();
    else if (lvl.level === 'analyze-summary') renderAnalyzeSummary();
    else if (lvl.level === 'token-usage') renderTokenUsage();
    else if (lvl.level === 'queries-editor') renderQueriesEditor();
    else if (lvl.level === 'downloads') renderDownloads();
    else if (lvl.level === 'nb-config') renderNbConfig();
    else if (lvl.level === 'git-status') renderGitStatus();
    else if (lvl.level === 'articles') renderArticles();
    else if (lvl.level === 'progress') renderProgress(lvl.data);
    else renderHome();
  }

  // ===========================
  // Tile HTML helper
  // ===========================
  function createTileHtml(t, idx) {
    const cls = ['tile'];
    const dataIdx = idx !== undefined ? ` data-tile-index="${idx}"` : '';
    if (t.type === 'section') return `<div class="section-header"><span class="section-icon">${t.icon}</span><span class="section-title">${t.label}</span></div>`;
    if (t.type === 'nav') cls.push('tile-nav');
    else if (t.type === 'action') cls.push('tile-action');
    else if (t.type === 'toggle') cls.push('tile-toggle');
    else if (t.type === 'choice') cls.push('tile-choice');
    else if (t.type === 'config') cls.push('tile-config');
    else if (t.type === 'back') cls.push('tile-back');
    if (t.selected) cls.push('selected');
    if (t.running) cls.push('running');
    const icon = t.type === 'back' ? '←' : t.icon;
    const label = t.label || '';
    const desc = t.desc || '';

    if (t.type === 'config') {
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <div class="config-label">${label}</div>
        <div class="config-value${desc ? '' : ' empty'}">${desc || '—'}</div>
      </div>`;
    }
    if (t.type === 'back') {
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <span class="tile-icon">${icon}</span>
        <div class="tile-label">${label || 'Powrót'}</div>
      </div>`;
    }
    if (t.type === 'stat') {
      cls.push('tile-stat');
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <span class="stat-icon">${icon}</span>
        <div class="stat-value">${t.value || '—'}</div>
        <div class="tile-label">${label}</div>
      </div>`;
    }
    return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
      <span class="tile-icon">${icon}</span>
      <div class="tile-label">${label}</div>
      ${desc ? `<div class="tile-desc">${desc}</div>` : ''}
    </div>`;
  }

  function renderTiles(tiles, onTileClick) {
    tilesEl.style.display = 'grid';
    tilesEl.innerHTML = tiles.map((t, i) => createTileHtml(t, i)).join('');
    // stagger reveal
    requestAnimationFrame(() => {
      tilesEl.querySelectorAll('.tile').forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), 60 + i * 50);
      });
    });
    // click handlers
    tilesEl.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tile')) {
          const idx = parseInt(el.dataset.tileIndex);
          if (!isNaN(idx)) onTileClick(tiles[idx], el);
        }
      });
    });
  }

  // ===========================
  // Level renderers
  // ===========================

  function renderHome() {
    const tiles = [];
    function sec(icon, title) { tiles.push({ type:'section', icon, label:title }); }

    // Status section — always visible at top
    sec('🧠','Status systemu');
    const nvidiaOnline = modelsList.length > 0;
    tiles.push(
      { type:'config', icon: nvidiaOnline ? '🟢' : '🔴', label:'NVIDIA API', desc: nvidiaOnline ? `Online · ${settingsCache.model || modelsList[0] || '—'}` : 'Offline — ustaw NVIDIA_API_KEY' },
    );
    if (!nbAuthed) {
      tiles.push(
        { type:'action', icon:'🔑', label:'Zaloguj do NotebookLM', desc:'Wymagane do analizy i badań AI', nbAuthAction:'login' },
        { type:'config', icon:'🔴', label:'NotebookLM', desc:'Nie zalogowano' },
      );
    } else {
      tiles.push(
        { type:'config', icon:'🟢', label:'NotebookLM', desc:'Zalogowano — gotowe do pracy' },
      );
    }

    // Workflow pipeline
    sec('📋','Pipeline pracy');
    tiles.push(
      { type:'nav', icon:'1️⃣', label:'Przeglądaj artykuły', desc:'Zobacz co już wygenerowano · otwórz, podgląd, metadane' },
      { type:'nav', icon:'2️⃣', label:'Znajdź newsy', desc:'RSS, Google News, Auto-watch · zbierz materiał do przeróbki' },
      { type:'nav', icon:'3️⃣', label:'Generuj treści', desc:'AI pisze artykuł · z tematu, RSS lub NotebookLM' },
      { type:'nav', icon:'4️⃣', label:'Publikuj i analizuj', desc:'Newsletter · Git push · Analiza konkurencji · Luki' },
    );

    // Quick actions
    sec('⚡','Szybkie akcje');
    tiles.push(
      { type:'action', icon:'💬', label:'Generuj z tematu', desc:'Wpisz temat — AI napisze artykuł', action:'generate', needsInput:true, inputLabel:'Temat artykułu', inputPlaceholder:'np. Jak zacząć dropshipping B2B...', inputDefault:'Czym jest dropshipping B2B', askPush:true },
      { type:'action', icon:'🔥', label:'Warmup NVIDIA', desc:'Sprawdź połączenie z NVIDIA API', action:'warmup' },
    );

    sec('🛠️','Narzędzia');
    tiles.push(
      { type:'nav', icon:'⚙', label:'Ustawienia', desc:'Model, format, persona, ton, język' },
      { type:'nav', icon:'📉', label:'Telemetria', desc:'Statystyki, historia, użycie' },
      { type:'nav', icon:'🧠', label:'NotebookLM Studio', desc:'Źródła, raporty, audio, research' },
      { type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium, commity' },
    );

    // Target mapping
    const targetMap = {
      'Przeglądaj artykuły':'articles','Znajdź newsy':'rss','Generuj treści':'generuj','Publikuj i analizuj':'newsletter',
      'Ustawienia':'settings','Telemetria':'telemetry','NotebookLM Studio':'notebooklm','Git / Deploy':'git-status',
    };
    renderTiles(tiles, (t, el) => {
      if (t.action === 'warmup') { handleWarmup(el); return; }
      if (t.action === 'generate') { handleActionTile(t, el); return; }
      if (t.nbAuthAction === 'login') { handleNbLoginFromDashboard(el); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      if (t.type === 'section' || t.type === 'config') return;
      const target = targetMap[t.label];
      if (target) pushLevel({ level: target });
    });
  }

  // NB login from dashboard button
  async function handleNbLoginFromDashboard(el) {
    el.classList.add('running');
    try {
      const r = await fetch('/api/nb/login', { method:'POST' });
      const d = await r.json();
      el.classList.remove('running');
      if (d.ok) {
        showToast('✅ ' + (d.message || 'Zalogowano do NotebookLM'), '');
        nbAuthed = true;
        updateNbStatusUI();
        render();
      } else {
        showToast('Błąd logowania: ' + (d.error || 'nieznany'), 'err');
      }
    } catch (e) { el.classList.remove('running'); showToast('Błąd sieci: ' + e.message, 'err'); }
  }

  // ===========================
  // Article browsing — rich cards, content-first
  // ===========================
  const FMT_BADGE = {
    article:   { color:'var(--green)',  bg:'var(--green-glow)',      label:'Standard' },
    list:      { color:'var(--amber)',  bg:'rgba(245,158,11,.15)',    label:'Top lista' },
    howto:     { color:'var(--blue)',   bg:'rgba(59,130,246,.15)',    label:'Poradnik' },
    explainer: { color:'var(--cyan)',   bg:'var(--cyan-glow)',        label:'Czym jest' },
    vs:        { color:'var(--purple)', bg:'rgba(139,92,246,.15)',    label:'Porównanie' },
    myth:      { color:'var(--pink)',   bg:'rgba(236,72,153,.15)',    label:'Mit/fakt' },
    faq:       { color:'var(--indigo)', bg:'rgba(99,102,241,.15)',    label:'FAQ' },
    digest:    { color:'var(--cyan)',   bg:'var(--cyan-glow)',        label:'Przegląd' },
    opinion:   { color:'var(--pink)',   bg:'rgba(236,72,153,.15)',    label:'Opinia' },
  };

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'przed chwilą';
    if (diff < 3600) return Math.floor(diff / 60) + ' min temu';
    if (diff < 86400) return Math.floor(diff / 3600) + ' godz temu';
    if (diff < 172800) return 'wczoraj';
    if (diff < 604800) return Math.floor(diff / 86400) + ' dni temu';
    return new Date(dateStr).toLocaleDateString('pl-PL', {day:'numeric',month:'short'});
  }

  async function renderArticles() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📄</div><div class="result-title">Artykuły</div><div class="result-desc">Ładowanie...</div></div>';
    let data;
    try { const r = await fetch('/api/articles'); data = await r.json(); } catch { data = { articles: [], error: 'Błąd sieci' }; }
    const articles = data.articles || [];
    window._articlesData = articles;

    let html = '<div class="articles-browser">';

    // Header + search + filters
    html += '<div class="art-header-bar">';
    html += '<div class="art-header-left"><span style="font-size:1.1rem">📄</span><strong>Artykuły</strong><span style="font-size:.72rem;color:var(--text-muted)">' + (data.total || 0) + '</span></div>';
    html += '<div class="art-header-right">';
    html += '<input class="art-search" id="artSearch" placeholder="Szukaj tytułu, fragmentu..." autocomplete="off">';
    html += '</div>';
    html += '</div>';

    // Format filter chips
    html += '<div class="art-filters" id="artFilters">';
    html += '<button class="art-filter-chip active" data-fmt="all">Wszystkie</button>';
    const usedFormats = new Set(articles.map(a => a.format || 'article'));
    usedFormats.forEach(fmt => {
      const badge = FMT_BADGE[fmt] || FMT_BADGE.article;
      html += '<button class="art-filter-chip" data-fmt="' + esc(fmt) + '" style="--chip-color:' + badge.color + ';--chip-bg:' + badge.bg + '">' + badge.label + '</button>';
    });
    html += '</div>';

    if (articles.length === 0) {
      html += '<div class="art-empty">';
      html += '<div class="art-empty-icon">📭</div>';
      html += '<div class="art-empty-title">Brak wygenerowanych artykułów</div>';
      html += '<div class="art-empty-desc">Przejdź do <span class="art-empty-link" onclick="document.querySelector(\'.sidebar-action[data-action=home]\').click()">Dashboard → Generuj treści</span> i wygeneruj pierwszy artykuł. Tutaj zobaczysz podgląd każdej treści — tytuł, fragment tekstu, format i metadane.</div>';
      html += '</div>';
    } else {
      html += '<div class="art-cards" id="artCards">';
      articles.forEach(a => {
        const badge = FMT_BADGE[a.format] || FMT_BADGE.article;
        const rtime = relativeTime(a.date);
        const snippet = a.snippet || '';
        const words = a.words ? a.words + ' słów' : '';
        const source = a.source || '';
        html += '<div class="art-card" data-slug="' + esc(a.slug) + '" data-fmt="' + esc(a.format || 'article') + '" data-title="' + esc(a.title) + '" data-file="' + esc(a.file || '') + '" onclick="if(!event.target.closest(\'a,button,.art-card-actions *\')){const d=this.dataset;window._showArticlePreview(d.slug,d.file,d.title,\'\')}">';
        // Format badge
        html += '<div class="art-card-top">';
        html += '<span class="art-format-badge" style="color:' + badge.color + ';background:' + badge.bg + '">' + badge.label + '</span>';
        html += '<span class="art-card-time">' + (rtime || '—') + '</span>';
        html += '</div>';
        // Title
        html += '<div class="art-card-title">' + esc(a.title || a.slug) + '</div>';
        // Snippet
        if (snippet) {
          html += '<div class="art-card-snippet">' + esc(snippet) + (snippet.length >= 280 ? '…' : '') + '</div>';
        }
        // Meta row
        html += '<div class="art-card-meta">';
        if (words) html += '<span>' + words + '</span>';
        if (source) html += '<span title="' + esc(source) + '">' + esc(source).slice(0, 50) + '</span>';
        html += '</div>';
        // Actions
        html += '<div class="art-card-actions">';
        html += '<a class="art-action-btn" href="/articles/' + esc(a.slug) + '.html" target="_blank" title="Otwórz">📎 Otwórz</a>';
        html += '<button class="art-action-btn" onclick="event.stopPropagation();navigator.clipboard.writeText(location.origin+\'/articles/' + esc(a.slug) + '.html\');window._showToast && window._showToast(\'Skopiowano link\',\'\')" title="Kopiuj link">🔗 Kopiuj</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '<div style="margin-top:20px;text-align:center"><button class="result-btn" id="articlesBackBtn">←  Powrót</button></div>';
    html += '</div>';
    tilesEl.innerHTML = html;

    // Event wiring
    document.getElementById('articlesBackBtn').addEventListener('click', () => popLevel());

    // Search
    const searchEl = document.getElementById('artSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        applyArticleFilters();
      });
    }

    // Format filters
    document.querySelectorAll('.art-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.art-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        applyArticleFilters();
      });
    });

    // Expose for inline onclick
    window._showArticlePreview = showArticlePreview;
    window._showToast = showToast;
  }

  function applyArticleFilters() {
    const search = (document.getElementById('artSearch')?.value || '').toLowerCase();
    const activeFmt = document.querySelector('.art-filter-chip.active')?.dataset.fmt || 'all';
    document.querySelectorAll('.art-card').forEach(card => {
      const fmt = card.dataset.fmt;
      const title = (card.dataset.title || '').toLowerCase();
      const snippet = (card.querySelector('.art-card-snippet')?.textContent || '').toLowerCase();
      const fmtMatch = activeFmt === 'all' || fmt === activeFmt;
      const searchMatch = !search || title.includes(search) || snippet.includes(search);
      card.style.display = fmtMatch && searchMatch ? '' : 'none';
    });
    const visible = document.querySelectorAll('.art-card[style=""]').length || document.querySelectorAll('.art-card:not([style*="display: none"])').length;
  }

  function showArticlePreview(slug, file, title, desc) {
    const filePath = file.replace(/\\/g, '/');
    const html = `
      <div style="text-align:left">
        <p style="color:var(--text-bright);font-weight:600;margin-bottom:4px">${escapeHtml(title)}</p>
        <p style="color:var(--text-dim);font-size:.75rem;margin-bottom:8px">${escapeHtml(desc)}</p>
        <p style="color:var(--text-dim);font-size:.7rem;margin-bottom:12px"><code style="color:var(--green);font-size:.68rem">${escapeHtml(filePath)}</code></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="dialog-btn dialog-btn-primary" style="text-decoration:none;display:inline-flex;align-items:center" href="/articles/${slug}.html" target="_blank">📎 Otwórz artykuł</a>
          <button class="dialog-btn dialog-btn-secondary" id="articlePreviewClose">↩ Zamknij</button>
        </div>
      </div>`;
    showDialog('Podgląd artykułu', html, []).then(() => {});
    setTimeout(() => {
      const closeBtn = document.getElementById('articlePreviewClose');
      if (closeBtn) closeBtn.addEventListener('click', closeDialog);
    }, 50);
  }

  // Action sub-levels (generuj, rss, review, analyze, newsletter)
  function renderActionLevel(level) {
    const defs = {
      generuj: [
        // ── Group A: Skąd materiał ──
        { type:'section', icon:'📥', label:'Źródło materiału' },
        { type:'action', icon:'📋', label:'Z kolejki tematów', desc:'Weź następny pending z kolejki i wygeneruj artykuł', action:'generate-from-queue' },
        { type:'action', icon:'📡', label:'Z RSS (wybierz feed)', desc:'Wybierz feed z 42 kuratorowanych kanałów RSS', action:'rss-pick' },
        { type:'action', icon:'🔬', label:'Z NB Research', desc:'Artykuł na podstawie źródeł z ostatniego researchu', action:'generate-from-research' },
        { type:'action', icon:'🎯', label:'Z luk tematycznych', desc:'Weź pierwszą niewypełnioną lukę z gap-report.json i wygeneruj artykuł', action:'generate-from-gap' },
        { type:'action', icon:'💬', label:'Z własnego promptu', desc:'Wpisz temat — AI napisze artykuł', action:'generate', needsInput:true, inputLabel:'Temat artykułu', inputPlaceholder:'np. Jak zacząć dropshipping B2B...' },

        // ── Group B: Batch ──
        { type:'section', icon:'⚡', label:'Batch & Pipeline' },
        { type:'action', icon:'⚡', label:'Przetwórz całą kolejkę', desc:'Wygeneruj artykuły dla wszystkich pending tematów', action:'process-queue' },

        // ── Group C: Narzędzia ──
        { type:'section', icon:'🛠️', label:'Narzędzia' },
        { type:'action', icon:'🔄', label:'Regeneruj index/feed', desc:'Odśwież index.html, sitemap.xml i feed.xml (bez generowania)', action:'regenerate-index' },
        { type:'nav', icon:'📝', label:'NB Studio', desc:'Raporty, audio, wideo przez NotebookLM', gotoLevel:{ level:'nb-studio' } },
      ],
      rss: [
        { type:'action', icon:'🔍', label:'Przeglądaj RSS', desc:'Wczytaj feed, przeglądaj nagłówki, dodaj do kolejki tematów', gotoLevel:{ level:'rss-feed-picker' } },
        { type:'action', icon:'📋', label:'Kolejka tematów', desc:'Lista zapisanych tematów gotowych do opracowania', gotoLevel:{ level:'topic-queue' } },
        { type:'action', icon:'➕', label:'Dodaj temat', desc:'Ręcznie dodaj URL/tytuł do kolejki', action:'add-topic', needsInput:true, inputLabel:'URL lub tytuł tematu', inputPlaceholder:'Wklej URL lub wpisz tytuł...' },
        { type:'action', icon:'📰', label:'NB Digest', desc:'Podsumowanie NotebookLM News — streszczenie wszystkich źródeł', action:'nb-digest' },
        { type:'action', icon:'🔬', label:'NB Web Research', desc:'Research z query — deep mode przez NotebookLM', action:'nb-web-research' },
        { type:'nav', icon:'📡', label:'Auto-watch', desc:'Monitoruj wszystkie feedy automatycznie', gotoLevel:{ level:'auto-watch' } },
      ],
      review: [
        { type:'action', icon:'📝', label:'Review all', desc:'Przejrzyj wszystkie nowe wpisy', action:'review' },
        { type:'action', icon:'❌', label:'Review fail', desc:'Przejrzyj tylko błędne', action:'review' },
      ],
      analyze: [
        { type:'action', icon:'📊', label:'Analiza treści', desc:'Wykonaj analizę luk i konkurencji', action:'analyze' },
        { type:'action', icon:'💡', label:'NB Insights', desc:'Source guide + Research + Prompty', gotoLevel:{ level:'nb-insights' } },
        { type:'action', icon:'🔬', label:'NB Deep Research', desc:'Badania przez NotebookLM', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
        { type:'action', icon:'🏁', label:'NB Keywords', desc:'Analiza słów kluczowych', gotoLevel:{ level:'nb-category', notebookKey:'ads' } },
        { type:'action', icon:'🏁', label:'Konkurencja', desc:'Lista konkurencji', gotoLevel:{ level:'competitors' } },
        { type:'action', icon:'🔍', label:'Luki tematyczne', desc:'Analiza luk', gotoLevel:{ level:'gaps' } },
        { type:'nav', icon:'📈', label:'Podsumowanie analizy', desc:'Metryki i statystyki', gotoLevel:{ level:'analyze-summary' } },
        { type:'nav', icon:'🔢', label:'Tokeny i zużycie', desc:'Statystyki użycia', gotoLevel:{ level:'token-usage' } },
      ],
      newsletter: [
        { type:'section', icon:'📧', label:'Newsletter' },
        { type:'action', icon:'📝', label:'Generuj HTML newslettera', desc:'Wygeneruj plik HTML newslettera tygodniowego', action:'newsletter' },
        { type:'config', icon:'📤', label:'Wysyłka newslettera', desc:'Funkcja w przygotowaniu — backend SMTP nie jest skonfigurowany' },
        { type:'section', icon:'🎙️', label:'NotebookLM — Publikacja' },
        { type:'action', icon:'🎙️', label:'NB Audio Briefing', desc:'Briefing audio przez NotebookLM', gotoLevel:{ level:'nb-category', notebookKey:'audio' } },
        { type:'action', icon:'🎬', label:'NB Studio', desc:'Generuj audio/wideo/report', gotoLevel:{ level:'nb-studio' } },
        { type:'section', icon:'📊', label:'Analiza i monitoring' },
        { type:'action', icon:'🏁', label:'Konkurencja', desc:'Lista konkurencji', gotoLevel:{ level:'competitors' } },
        { type:'action', icon:'🔍', label:'Luki tematyczne', desc:'Analiza luk', gotoLevel:{ level:'gaps' } },
        { type:'nav', icon:'📈', label:'Podsumowanie analizy', desc:'Metryki i statystyki', gotoLevel:{ level:'analyze-summary' } },
        { type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium, commity', gotoLevel:{ level:'git-status' } },
      ],
    };
    const tiles = [...(defs[level] || [])];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleActionTile(t, el);
    });
  }

  // ===========================
  // RSS feed picker — curated list of feeds + custom URL
  // ===========================
  async function renderRssFeedPicker() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📡</div><div class="result-title">Kanały RSS</div><div class="result-desc">Ładowanie...</div></div>';
    try {
      const resp = await fetch('/api/feeds');
      const data = await resp.json();
      const feeds = data.feeds || [];
      if (!feeds.length) { tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📭</div><div class="result-title">Brak feedów</div><div class="result-desc">Dodaj feedy w feeds.json</div></div>'; return; }
      const regions = [
        { label:'USA Tech / Business',     keys:['techcrunch','verge','wired','cnbc','venturebeat','mit','forbes','bloomberg','ars','register','business insider','hacker news'] },
        { label:'Social / Reddit',         keys:['reddit'] },
        { label:'Amazon / E-commerce',    keys:['amazon','seller','FBA','dropshipping','ecommerce','e-commerce','shopify','aliexpress','shein','temu','retail','marketing'] },
        { label:'China',                   keys:['china','scmp','technode','caixin'] },
        { label:'EU',                      keys:['eu','sifted','tech.eu','eu-startups','next web'] },
        { label:'Google News',             keys:['gnews','google news'] },
        { label:'Logistyka / Supply Chain',keys:['supply','logistic','tariff','trade'] },
      ];
      function matchRegion(name) {
        const n = name.toLowerCase();
        for (const r of regions) { for (const k of r.keys) { if (n.includes(k)) return r.label; } }
        return 'Inne';
      }
      const grouped = {};
      feeds.forEach(f => {
        const g = matchRegion(f.name);
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(f);
      });
      let html = '<div class="feed-picker-wrap">';
      html += '<div style="font-size:.78rem;margin-bottom:12px;color:var(--text-muted)">42 kanały RSS — kliknij aby przeglądać i dodać tematy do kolejki</div>';
      for (const [group, list] of Object.entries(grouped)) {
        html += '<div class="feed-group"><div class="feed-group-head">' + group + ' (' + list.length + ')</div><div class="feed-grid">';
        list.forEach(f => {
          html += '<div class="feed-chip" data-url="' + esc(f.url) + '" data-name="' + esc(f.name) + '">' + esc(f.name) + '</div>';
        });
        html += '</div></div>';
      }
      html += '<div class="feed-group"><div class="feed-group-head">Własny</div><div class="feed-chip feed-chip-custom" id="customFeedBtn">✏️  Wpisz własny URL RSS...</div></div>';
      html += '<div style="margin-top:20px;text-align:center"><button class="result-btn feed-back-btn">←  Powrót</button></div>';
      html += '</div>';
      tilesEl.innerHTML = html;
      document.querySelector('.feed-back-btn').addEventListener('click', () => popLevel());
      document.getElementById('customFeedBtn').addEventListener('click', async () => {
        const url = await showInputDialogValue('Własny URL', 'Wpisz URL feedu RSS...', 'https://');
        if (!url) return;
        pushLevel({ level: 'rss-browse', data: { url } });
      });
      document.querySelectorAll('.feed-chip:not(#customFeedBtn)').forEach(el => {
        el.addEventListener('click', () => {
          const url = el.dataset.url;
          const name = el.dataset.name;
          pushLevel({ level: 'rss-browse', data: { url, name } });
        });
      });
    } catch (e) {
      tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd</div><div class="result-desc">' + esc(e.message) + '</div></div>';
    }
  }

  // ===========================
  // RSS browse — fetch feed, show items with add-to-queue
  // ===========================
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function renderRssBrowse(lvl) {
    tilesEl.style.display = 'block';
    const feedUrl = lvl.data && lvl.data.url;
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">🔍</div><div class="result-title">Wczytywanie feeda...</div><div class="result-desc">' + esc(feedUrl) + '</div></div>';
    try {
      const resp = await fetch('/api/rss/parse?url=' + encodeURIComponent(feedUrl));
      const data = await resp.json();
      if (data.error) { tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd</div><div class="result-desc">' + esc(data.error) + '</div></div>'; return; }
      const items = data.items || [];
      const feedTitle = data.feed && data.feed.title ? data.feed.title : 'Feed RSS';
      let html = '<div class="rss-items-wrap">';
      html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="font-size:1.2rem">🔍</span><strong>' + esc(feedTitle) + '</strong><span style="font-size:.75rem;color:var(--text-muted)">(' + items.length + ' wpisów)</span></div>';
      html += '<button class="result-btn" id="rssAddAll" style="margin-bottom:12px;width:100%">➕  Dodaj wszystkie do kolejki</button>';
      html += '<div class="rss-items-grid">';
      items.forEach((item, i) => {
        const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString('pl-PL') : '';
        html += '<div class="rss-item" data-idx="' + i + '" style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:background .15s">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">';
        html += '<div style="flex:1;min-width:0"><div style="font-size:.8rem;font-weight:600;line-height:1.3">' + esc(item.title) + '</div>';
        if (date) html += '<div style="font-size:.68rem;color:var(--text-muted);margin-top:2px">' + date + '</div>';
        if (item.contentSnippet) html += '<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(item.contentSnippet) + '</div>';
        html += '</div>';
        html += '<button class="result-btn rss-add-btn" data-idx="' + i + '" style="flex-shrink:0;font-size:.72rem;padding:4px 10px">+ Kolejka</button>';
        html += '</div></div>';
      });
      html += '</div>'; // .rss-items-grid
      html += '<div style="margin-top:16px;text-align:center"><button class="result-btn" id="rssBackBtn">←  Powrót</button></div>';
      html += '</div>'; // .rss-items-wrap
      tilesEl.innerHTML = html;
      const backBtn = document.getElementById('rssBackBtn');
      if (backBtn) backBtn.addEventListener('click', () => popLevel());
      document.querySelectorAll('.rss-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const item = items[idx];
          btn.textContent = '...';
          btn.disabled = true;
          try {
            const r = await fetch('/api/topics', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title: item.title, url: item.link || '', source: feedTitle, guid: item.guid }) });
            const d = await r.json();
            if (d.ok) { btn.textContent = '✓'; btn.style.borderColor = 'var(--success)'; showToast('✅ Dodano: ' + item.title.slice(0, 40), ''); }
            else { btn.textContent = 'Błąd'; showToast('Błąd: ' + (d.error || ''), 'err'); }
          } catch (e) { btn.textContent = 'Błąd'; showToast('Błąd sieci: ' + e.message, 'err'); }
        });
      });
      const addAllBtn = document.getElementById('rssAddAll');
      if (addAllBtn) {
        addAllBtn.addEventListener('click', async () => {
          addAllBtn.textContent = '⏳ Dodawanie...';
          addAllBtn.disabled = true;
          let ok = 0, err = 0;
          for (const item of items) {
            try {
              const r = await fetch('/api/topics', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title: item.title, url: item.link || '', source: feedTitle, guid: item.guid }) });
              const d = await r.json();
              if (d.ok) ok++; else err++;
            } catch { err++; }
          }
          showToast('✅ Dodano ' + ok + ' tematów' + (err ? ', błędy: ' + err : ''), '');
          addAllBtn.textContent = '✅  Dodano ' + ok;
        });
      }
    } catch (e) {
      tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd sieci</div><div class="result-desc">' + e.message + '</div></div>';
    }
  }

  // ===========================
  // Topic queue — view, remove, mark as done
  // ===========================
  // Feed picker for generation mode — click feed → generate article
  // ===========================
  async function renderRssFeedPickerGen() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📡</div><div class="result-title">Generuj z RSS</div><div class="result-desc">Ładowanie feedów...</div></div>';
    try {
      const resp = await fetch('/api/feeds');
      const data = await resp.json();
      const feeds = data.feeds || [];
      if (!feeds.length) { tilesEl.innerHTML = '<div class="result-card">Brak feedów</div>'; return; }
      let html = '<div style="max-width:640px;margin:0 auto">';
      html += '<div style="font-size:.78rem;margin-bottom:8px;color:var(--text-muted)">Wybierz feed — automatycznie weźmie pierwszy nieprzetworzony wpis i wygeneruje artykuł</div>';
      feeds.forEach(f => {
        html += '<div class="feed-chip feed-gen-item" data-url="' + esc(f.url) + '" data-name="' + esc(f.name) + '" style="display:block;width:100%;text-align:left;margin-bottom:4px">📡 ' + esc(f.name) + '</div>';
      });
      html += '<div style="margin-top:16px;text-align:center"><button class="result-btn" id="fpgBackBtn">←  Powrót</button></div>';
      html += '</div>';
      tilesEl.innerHTML = html;
      document.getElementById('fpgBackBtn').addEventListener('click', () => popLevel());
      document.querySelectorAll('.feed-gen-item').forEach(el => {
        el.addEventListener('click', async () => {
          const url = el.dataset.url;
          const fmtOverride = await showFormatPicker();
          if (fmtOverride === null) return;
          el.classList.add('running');
          const body = { url, push: false };
          if (fmtOverride && fmtOverride !== 'default') { body.format = fmtOverride.format; body.persona = fmtOverride.persona; }
          body.verbose = !!settingsCache._verbose;
          try {
            const resp = await fetch('/api/run/rss', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
            const d = await resp.json();
            if (!d.ok) { showToast('Błąd: ' + (d.error||''), 'err'); el.classList.remove('running'); return; }
            running = { tileAction: { label:'RSS: '+el.dataset.name }, el, output:'' };
            pushLevel({ level:'progress', data:{ action:'rss', label:'RSS: '+el.dataset.name } });
            const es = new EventSource('/api/run/'+d.runId+'/stream');
            running.es = es; running.runId = d.runId;
            es.onmessage = (e) => {
              try {
                const m = JSON.parse(e.data);
                if (m.type==='connected') return;
                if (m.done) { es.close(); el.classList.remove('running'); if(running&&running._progressTimer) clearInterval(running._progressTimer); if(running&&running._escHandler) document.removeEventListener('keydown', running._escHandler); addJobToQueue('RSS: '+el.dataset.name, m.error?'error':'done', m.output); running=null; navStack=navStack.filter(l=>l.level!=='progress'); var gr3 = window._genResult; window._genResult = null; pushLevel({level:'result',data:{success:!m.error,error:m.error,action:'rss',output:m.output||'',genResult:gr3||null}}); return; }
                if (m.type==='event' && m.event) { if(currentLevel().level==='progress') renderProgressLive(m.event); }
                else if (m.data) { running.output=(running.output||'')+m.data; if(currentLevel().level==='progress') renderProgressLive(running.output); }
              } catch {}
            };
            es.onerror = () => { es.close(); showToast('Utracono połączenie','err'); el.classList.remove('running'); if(running&&running._progressTimer) clearInterval(running._progressTimer); running=null; navStack=navStack.filter(l=>l.level!=='progress'); render(); };
          } catch(e) { el.classList.remove('running'); showToast('Błąd sieci: '+e.message,'err'); }
        });
      });
    } catch(e) { tilesEl.innerHTML = '<div class="result-card">Błąd: '+esc(e.message)+'</div>'; }
  }

  // ===========================
  async function renderTopicQueue() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📋</div><div class="result-title">Kolejka tematów</div><div class="result-desc">Ładowanie...</div></div>';
    try {
      const resp = await fetch('/api/topics');
      const data = await resp.json();
      const topics = data.topics || [];
      if (!topics.length) {
        tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📭</div><div class="result-title">Kolejka pusta</div><div class="result-desc">Dodaj tematy przez Przeglądaj RSS lub ręcznie</div></div>';
        return;
      }
      const pending = topics.filter(t => t.status === 'pending').length;
      const done = topics.filter(t => t.status === 'done').length;
      let html = '<div>';
      html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="font-size:1.2rem">📋</span><strong>Kolejka tematów</strong><span style="font-size:.75rem;color:var(--text-muted)">(' + pending + ' oczekujących, ' + done + ' gotowych)</span></div>';
      topics.forEach((topic) => {
        const date = topic.date ? new Date(topic.date).toLocaleDateString('pl-PL') : '';
        const isDone = topic.status === 'done';
        html += '<div class="topic-item" data-id="' + topic.id + '" style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;display:grid;grid-template-columns:30px 1fr 160px 100px 60px;gap:8px;align-items:center;opacity:' + (isDone ? '.55' : '1') + '">';
        html += '<span style="font-size:.9rem;text-align:center">' + (isDone ? '✅' : '⏳') + '</span>';
        html += '<div style="min-width:0"><div style="font-size:.8rem;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(topic.title) + '</div>';
        if (topic.url) html += '<div style="font-size:.68rem;margin-top:2px"><a href="' + esc(topic.url) + '" target="_blank" style="color:var(--accent)">' + esc(topic.url).slice(0, 50) + '</a></div>';
        html += '</div>';
        html += '<span style="font-size:.7rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(topic.source || '—') + '</span>';
        html += '<span style="font-size:.68rem;color:var(--text-muted);white-space:nowrap">' + date + '</span>';
        html += '<div style="display:flex;gap:3px">';
        if (!isDone) html += '<button class="result-btn topic-done-btn" data-id="' + topic.id + '" style="font-size:.68rem;padding:3px 6px">✅</button>';
        html += '<button class="result-btn topic-del-btn" data-id="' + topic.id + '" style="font-size:.68rem;padding:3px 6px">🗑</button>';
        html += '</div></div>';
      });
      html += '<div style="margin-top:16px;text-align:center"><button class="result-btn" id="topicBackBtn">←  Powrót</button></div>';
      html += '</div>';
      tilesEl.innerHTML = html;
      const topicBackBtn = document.getElementById('topicBackBtn');
      if (topicBackBtn) topicBackBtn.addEventListener('click', () => popLevel());
      document.querySelectorAll('.topic-done-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          try {
            await fetch('/api/topics/' + id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:'done' }) });
            showToast('✅ Oznaczono jako gotowe', '');
            renderTopicQueue();
          } catch (e) { showToast('Błąd: ' + e.message, 'err'); }
        });
      });
      document.querySelectorAll('.topic-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!await showConfirm('Usunąć?', 'Usunąć ten temat z kolejki?', 'Usuń', 'Anuluj')) return;
          try {
            await fetch('/api/topics/' + id, { method:'DELETE' });
            showToast('🗑 Usunięto', '');
            renderTopicQueue();
          } catch (e) { showToast('Błąd: ' + e.message, 'err'); }
        });
      });
    } catch (e) {
      tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd sieci</div><div class="result-desc">' + e.message + '</div></div>';
    }
  }

  // ===========================
  // Research history — saved research outputs
  // ===========================
  async function renderResearchHistory() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📜</div><div class="result-title">Historia researchu</div><div class="result-desc">Ładowanie...</div></div>';
    try {
      const resp = await fetch('/api/research-results');
      const data = await resp.json();
      const results = data.results || [];
      if (!results.length) {
        tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📭</div><div class="result-title">Brak wyników</div><div class="result-desc">Uruchom Web Research aby zobaczyć tu historię</div></div>';
        return;
      }
      let html = '<div style="max-width:640px;margin:0 auto">';
      html += '<div style="font-size:.8rem;margin-bottom:12px;color:var(--text-muted)">' + results.length + ' zapisanych researchy</div>';
      results.forEach((r, i) => {
        const date = r.date ? new Date(r.date).toLocaleDateString('pl-PL') + ' ' + new Date(r.date).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'}) : '';
        html += '<div class="research-entry" id="research-' + i + '" style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;cursor:pointer">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">';
        html += '<div style="font-size:.78rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📜 ' + esc(r.query || '---') + '</div>';
        html += '<span style="font-size:.65rem;color:var(--text-muted);flex-shrink:0">' + date + '</span>';
        html += '</div></div>';
      });
      html += '<div style="margin-top:16px;text-align:center"><button class="result-btn" id="rhBackBtn">←  Powrót</button></div>';
      html += '</div>';
      tilesEl.innerHTML = html;
      document.getElementById('rhBackBtn').addEventListener('click', () => popLevel());
      document.querySelectorAll('.research-entry').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.id.replace('research-', ''));
          const r = results[idx];
          if (!r) return;
          const date = r.date ? new Date(r.date).toLocaleString('pl-PL') : '';
          showDialog('Research: ' + esc(r.query || '---'), '<div style="font-size:.7rem;color:var(--text-muted);margin-bottom:8px">' + date + '</div><pre style="white-space:pre-wrap;word-break:break-all;font-size:.7rem;max-height:50vh;overflow-y:auto;background:var(--bg);padding:8px;border-radius:4px">' + esc(r.output || '') + '</pre>', [
            { label:'Zamknij', style:'secondary', value:null },
          ]);
        });
      });
    } catch (e) {
      tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd</div><div class="result-desc">' + esc(e.message) + '</div></div>';
    }
  }

  // ===========================
  // Sources DB — all research links with categories
  // ===========================
  async function renderSourcesDB() {
    tilesEl.style.display = 'block';
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📚</div><div class="result-title">Baza źródeł</div><div class="result-desc">Ładowanie...</div></div>';
    try {
      const resp = await fetch('/api/research-sources');
      const data = await resp.json();
      renderSourcesDBWith(data);
    } catch (e) {
      tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">❌</div><div class="result-title">Błąd</div><div class="result-desc">' + esc(e.message) + '</div></div>';
    }
  }

  function renderSourcesDBWith(data) {
    const sources = data.sources || [];
    const categories = data.categories || [];
    let html = '<div style="max-width:700px;margin:0 auto">';
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">';
    html += '<button class="feed-chip cat-filter' + (!window._srcFilter ? ' active' : '') + '" data-cat="" style="font-size:.65rem;padding:4px 8px">Wszystkie (' + sources.length + ')</button>';
    categories.forEach(cat => {
      const ci = RESEARCH_CATEGORIES[cat] || { icon:'📊', label:cat };
      html += '<button class="feed-chip cat-filter' + (window._srcFilter === cat ? ' active' : '') + '" data-cat="' + esc(cat) + '" style="font-size:.65rem;padding:4px 8px">' + ci.icon + ' ' + ci.label + '</button>';
    });
    html += '</div>';
    if (!sources.length) {
      html += '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Brak źródeł w tej kategorii</div>';
    } else {
      sources.forEach(s => {
        const ci = RESEARCH_CATEGORIES[s.category] || { icon:'📊', label:s.category || 'ogólne' };
        const date = s.date ? new Date(s.date).toLocaleDateString('pl-PL') : '';
        html += '<div class="source-item" style="border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">';
        html += '<span style="font-size:.9rem;flex-shrink:0">' + ci.icon + '</span>';
        html += '<div style="flex:1;min-width:0">';
        html += '<a href="' + esc(s.url) + '" target="_blank" style="font-size:.76rem;font-weight:600;color:var(--accent);text-decoration:none">' + esc(s.title || s.url).slice(0, 80) + '</a>';
        html += '<div style="font-size:.64rem;color:var(--text-muted)">' + esc(s.researchQuery || '') + (date ? ' · ' + date : '') + '</div>';
        html += '</div>';
        html += '<button class="result-btn src-to-topic-btn" data-id="' + esc(s.id) + '" style="font-size:.65rem;padding:3px 8px;flex-shrink:0">📋 Kolejka</button>';
        html += '</div>';
      });
    }
    html += '<div style="margin-top:16px;text-align:center"><button class="result-btn" id="sdbBackBtn">←  Powrót</button></div>';
    html += '</div>';
    tilesEl.innerHTML = html;
    document.getElementById('sdbBackBtn').addEventListener('click', () => popLevel());
    document.querySelectorAll('.cat-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        window._srcFilter = cat || '';
        const url = cat ? '/api/research-sources?category=' + encodeURIComponent(cat) : '/api/research-sources';
        fetch(url).then(r => r.json()).then(d => renderSourcesDBWith(d)).catch(() => {});
      });
    });
    document.querySelectorAll('.src-to-topic-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        const id = btn.dataset.id;
        const s = sources.find(x => x.id === id);
        if (!s) return;
        btn.textContent = '...'; btn.disabled = true;
        try {
          const r = await fetch('/api/topics', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title: s.title, url: s.url, source: 'research-' + (s.researchQuery || ''), guid: s.url }) });
          const d = await r.json();
          if (d.ok) { btn.textContent = '✓'; showToast('Dodano do kolejki', ''); }
          else { btn.textContent = 'Błąd'; showToast('Błąd: ' + (d.error || ''), 'err'); }
        } catch (e2) { btn.textContent = 'Błąd'; showToast('Błąd sieci: ' + e2.message, 'err'); }
      });
    });
  }

  // ===========================
  // Generic NB action with live progress streaming
  // ===========================
  async function handleNbWithProgress(el, nbAction, args, label, category) {
    if (running) { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
    // Verify NB auth before running any command
    try {
      const authResp = await fetch('/api/nb/auth-status');
      const authData = await authResp.json();
      if (!authData.auth) {
        nbAuthed = false; updateNbStatusUI();
        showToast('🔑 NotebookLM nie zalogowany. Kliknij "Zaloguj do NotebookLM" w Dashboard', 'err');
        return;
      }
      nbAuthed = true; updateNbStatusUI();
    } catch { /* skip auth check on network error */ }
    el.classList.add('running');
    try {
      const resp = await fetch('/api/run/nb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nbAction, args }),
      });
      const data = await resp.json();
      if (!data.ok || !data.runId) {
        el.classList.remove('running');
        showToast('Błąd: ' + (data.error || 'nieznany'), 'err');
        return;
      }
      running = { tileAction: { label: label || nbAction }, el, output: '' };
      pushLevel({ level: 'progress', data: { action: 'nb-run', label: label || nbAction, nbAction } });
      const es = new EventSource(`/api/run/${data.runId}/stream`);
      running.es = es;
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'connected') return;
          if (msg.done) {
            es.close();
            el.classList.remove('running');
            if (running && running._progressTimer) clearInterval(running._progressTimer);
            addJobToQueue(label || nbAction, msg.error ? 'error' : 'done', msg.output);
            // Save research results to log
            if (nbAction === 'add-research' && msg.output) {
              const q = args[1] ? String(args[1]).split('--- Pytanie użytkownika ---').pop().trim().slice(0, 200) : (label || '');
              fetch('/api/research-results', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ query: q, output: msg.output, category: category || 'general' }) }).catch(() => {});
            }
            running = null;
            navStack = navStack.filter(l => l.level !== 'progress');
            pushLevel({ level: 'result', data: { success: !msg.error, error: msg.error, action: nbAction, label: label || nbAction, category: category || '', output: msg.output || '' } });
            return;
          }
          if (msg.data) {
            running.output = (running.output || '') + msg.data;
            if (currentLevel().level === 'progress') renderProgressLive(running.output);
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        showToast('Utracono połączenie z serwerem', 'err');
        el.classList.remove('running');
        if (running && running._progressTimer) clearInterval(running._progressTimer);
        running = null;
        navStack = navStack.filter(l => l.level !== 'progress');
        render();
      };
    } catch (e) {
      el.classList.remove('running');
      showToast('Błąd sieci: ' + e.message, 'err');
    }
  }

  // NotebookLM
  // ===========================
  function renderNotebooklm() {
    const tiles = [
      { type:'nav', icon:'📚', label:'Sources', desc:'Dodaj URL / PDF / YouTube jako źródło' },
      { type:'nav', icon:'🎬', label:'Studio', desc:'Generuj raporty, audio i wideo' },
      { type:'nav', icon:'💡', label:'Insights', desc:'Słowa kluczowe, badania, prompty' },
    ];
    tiles.push({ type:'nav', icon:'📓', label:'Notebooki', desc:'Lista wszystkich notebooków' });
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      const idx = tiles.indexOf(t);
      if (idx === 0) pushLevel({ level:'nb-sources' });
      else if (idx === 1) pushLevel({ level:'nb-studio' });
      else if (idx === 2) pushLevel({ level:'nb-insights' });
      else if (idx === 3) pushLevel({ level:'notebooklm-list' });
    });
  }

  function renderNbSources() {
    const tiles = [
      { type:'action', icon:'🔗', label:'Dodaj URL', desc:'Dodaj stronę / artykuł jako źródło', nbAction:'source-url' },
      { type:'action', icon:'▶️', label:'Dodaj YouTube', desc:'Dodaj film jako źródło', nbAction:'source-youtube' },
      { type:'action', icon:'📄', label:'Dodaj PDF', desc:'Dodaj plik PDF jako źródło', nbAction:'source-pdf' },
      { type:'action', icon:'🔬', label:'Web Research', desc:'Dodaj research z query', nbAction:'source-research' },
      { type:'nav', icon:'📜', label:'Historia researchu', desc:'Zapisane wyniki badań NotebookLM', gotoLevel:{ level:'research-history' } },
      { type:'nav', icon:'📚', label:'Baza źródeł', desc:'Linki z kategoriami — dodaj do kolejki', gotoLevel:{ level:'research-sources-db' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbSourceAdd(t, el);
    });
  }

  async function handleNbSourceAdd(t, el) {
    if (t.nbAction === 'source-url' || t.nbAction === 'source-youtube' || t.nbAction === 'source-pdf') {
      const label = t.nbAction === 'source-url' ? 'URL' : t.nbAction === 'source-youtube' ? 'YouTube URL' : 'Ścieżka do PDF';
      const url = await showInputDialogValue(`Dodaj ${label}`, `Wpisz ${label.toLowerCase()}...`);
      if (!url) return;
      const typeMap = { 'source-url':'url', 'source-youtube':'youtube', 'source-pdf':'url' };
      await handleNbWithProgress(el, 'source-add', [NB_NOTEBOOKS.sources.id, url, '--type', typeMap[t.nbAction]], 'Dodawanie źródła');
      return;
    }
    if (t.nbAction === 'source-research') {
      const category = await showCategoryPicker();
      if (!category) return;
      const query = await showInputDialogValue('Web Research', 'Czego szukać...');
      if (!query) return;
      const catInfo = RESEARCH_CATEGORIES[category];
      const catTag = catInfo ? catInfo.icon + ' ' + catInfo.label : category;
      // Prepend systemprompt context + category to guide NotebookLM research
      let fullQuery = query;
      try {
        const spResp = await fetch('/api/nb/init-context', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const spData = await spResp.json();
        if (spData.ok && spData.content) {
          fullQuery = spData.content + '\n\n--- Kategoria: ' + catTag + ' ---\n--- Pytanie użytkownika ---\n' + query;
        }
      } catch {}
      await handleNbWithProgress(el, 'add-research', [NB_NOTEBOOKS.research.id, fullQuery, '--mode', 'deep'], 'Research: ' + catTag, category);
    }
  }

  function renderNbStudio() {
    const tiles = [
      { type:'action', icon:'📝', label:'Generate Report', desc:'Raport blog-post z notebooka (format: blog-post)', nbAction:'studio-report' },
      { type:'action', icon:'🎙️', label:'Generate Audio', desc:'Podcast deep-dive z notebooka (format: deep-dive)', nbAction:'studio-audio' },
      { type:'action', icon:'🎬', label:'Generate Video', desc:'Briefing video z notebooka (format: briefing-doc)', nbAction:'studio-video' },
      { type:'action', icon:'⬇️', label:'Downloads', desc:'Pobierz artifacty z notebooka', nbAction:'studio-downloads' },
      { type:'nav', icon:'📰', label:'News Digest', desc:'Podsumowanie NotebookLM News — streszczenie wszystkich źródeł', gotoLevel:{ level:'nb-category', notebookKey:'news' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbStudioAction(t, el);
    });
  }

  async function handleNbStudioAction(t, el) {
    const action = t.nbAction;
    // Downloads: quick list (keep as-is, fast GET)
    if (action === 'studio-downloads') {
      const nbChoice = await showChoice('Wybierz notebook', 'Z którego notebooka pobrać?',
        { label: NB_NOTEBOOKS.news.title, value: 'news' },
        { label: NB_NOTEBOOKS.research.title, value: 'research' }
      );
      if (!nbChoice) return;
      const nbId = NB_NOTEBOOKS[nbChoice].id;
      el.classList.add('running');
      try {
        const resp = await fetch(`/api/nb/notebooks/${nbId}/artifacts`);
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        const artifacts = data.artifacts || [];
        if (!artifacts.length) { showToast('Brak artifactów', 'err'); return; }
        const items = artifacts.slice(0, 10).map(a => `• ${a.title || a.id} [${a.type || '?'}]`).join('\n');
        pushLevel({ level:'result', data: { success:true, action:`NB Artifacts (${artifacts.length})`, output: items || JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    // Studio report/audio/video: pick notebook, then stream
    const nbChoice = await showChoice('Wybierz notebook', 'Z którego notebooka?',
      { label: NB_NOTEBOOKS.news.title, value: 'news' },
      { label: NB_NOTEBOOKS.research.title, value: 'research' }
    );
    if (!nbChoice) return;
    const nbId = NB_NOTEBOOKS[nbChoice].id;
    const fmtMap = { 'studio-report':'blog-post', 'studio-audio':'deep-dive', 'studio-video':'briefing-doc' };
    const cmdMap = { 'studio-report':'generate-report', 'studio-audio':'generate-audio', 'studio-video':'generate-report' };
    const labelMap = { 'studio-report':'Generowanie raportu', 'studio-audio':'Generowanie audio', 'studio-video':'Generowanie video' };
    await handleNbWithProgress(el, cmdMap[action], [nbId, '--format', fmtMap[action]], labelMap[action]);
  }

  function renderNbInsights() {
    const tiles = [
      { type:'action', icon:'🔑', label:'Source Guide', desc:'Słowa kluczowe z notebooka', nbAction:'insights-guide' },
      { type:'action', icon:'🔬', label:'Deep Research', desc:'Głębokie badanie tematu', nbAction:'insights-research' },
      { type:'action', icon:'💬', label:'Suggest Prompts', desc:'Sugerowane prompty AI', nbAction:'insights-prompts' },
      { type:'nav', icon:'🔍', label:'Gap Analysis', desc:'Widok luk w NB Research', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbInsightsAction(t, el);
    });
  }

  async function handleNbInsightsAction(t, el) {
    const action = t.nbAction;
    if (action === 'insights-guide') {
      const query = await showInputDialogValue('Source Guide', 'Nazwa źródła (lub pierwsze litery ID)...');
      if (!query) return;
      el.classList.add('running');
      try {
        const srcResp = await fetch(`/api/nb/notebooks/${NB_NOTEBOOKS.research.id}/sources`);
        const srcData = await srcResp.json();
        const sources = srcData.sources || [];
        const match = sources.find(s => (s.title || '').toLowerCase().includes(query.toLowerCase()) || (s.id || '').includes(query));
        if (!match) { el.classList.remove('running'); showToast('Nie znaleziono źródła', 'err'); return; }
        el.classList.remove('running');
        await handleNbWithProgress(el, 'source-guide', [NB_NOTEBOOKS.research.id, match.id], 'Source Guide');
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    if (action === 'insights-research') {
      const category = await showCategoryPicker();
      if (!category) return;
      const query = await showInputDialogValue('Deep Research', 'Temat do zbadania...');
      if (!query) return;
      const catInfo = RESEARCH_CATEGORIES[category];
      const catTag = catInfo ? catInfo.icon + ' ' + catInfo.label : category;
      await handleNbWithProgress(el, 'add-research', [NB_NOTEBOOKS.research.id, query, '--mode', 'deep'], 'Research: ' + catTag, category);
      return;
    }
    if (action === 'insights-prompts') {
      const category = await showCategoryPicker();
      if (!category) return;
      showToast('Suggest prompts — poprzez ask() z promptem o sugestie', '');
      const question = 'Na podstawie zgromadzonych źródeł, zaproponuj 5 tematów artykułów które warto napisać. Podaj tytuł, format i uzasadnienie dla każdego.';
      const catInfo = RESEARCH_CATEGORIES[category];
      const catTag = catInfo ? catInfo.icon + ' ' + catInfo.label : category;
      await handleNbWithProgress(el, 'ask', [NB_NOTEBOOKS.research.id, question], 'Ask: ' + catTag, category);
    }
  }

  function renderNotebooklmList() {
    const tiles = Object.values(NB_NOTEBOOKS).map(nb => ({
      type:'nav', icon:nb.icon, label:nb.title, desc:nb.desc,
    }));
    tiles.push({ type:'back' });
    const keys = Object.keys(NB_NOTEBOOKS);
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      const idx = tiles.indexOf(t);
      pushLevel({ level:'nb-category', notebookKey:keys[idx] });
    });
  }

  function renderNbCategory(lvl) {
    const nb = NB_NOTEBOOKS[lvl.notebookKey];
    if (!nb) { popLevel(); return; }
    const tiles = [
      { type:'action', icon:'📄', label:'Podsumowanie', desc:'Pokaż podsumowanie notebooka', notebookId:nb.id, nbAction:'summary' },
      { type:'action', icon:'🔗', label:'Źródła', desc:'Lista źródeł', notebookId:nb.id, nbAction:'sources' },
      { type:'action', icon:'📝', label:'Generuj raport', desc:'Generuj raport z notebooka', notebookId:nb.id, nbAction:'report' },
      { type:'action', icon:'🎙️', label:'Generuj audio', desc:'Generuj podcast/audio', notebookId:nb.id, nbAction:'audio' },
      { type:'action', icon:'💬', label:'Zadaj pytanie', desc:'AI o zgromadzonych źródłach', notebookId:nb.id, nbAction:'ask' },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      handleNbAction(t, el);
    });
  }

  async function handleNbAction(t, el) {
    const nbId = t.notebookId;
    const action = t.nbAction;
    if (!nbId || !action) return;

    // Quick reads (summary, sources): keep synchronous
    if (action === 'summary') {
      el.classList.add('running');
      try {
        const r = await fetch(`/api/nb/notebooks/${nbId}/summary`);
        const d = await r.json();
        el.classList.remove('running');
        if (d.error) { showToast(`Błąd: ${d.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success: true, action: 'NB podsumowanie', output: d.output || JSON.stringify(d, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    if (action === 'sources') {
      el.classList.add('running');
      try {
        const r = await fetch(`/api/nb/notebooks/${nbId}/sources`);
        const d = await r.json();
        el.classList.remove('running');
        if (d.error) { showToast(`Błąd: ${d.error}`, 'err'); return; }
        const out = (d.sources || []).map(s => `• ${s.title || s.id}`).join('\n');
        pushLevel({ level:'result', data: { success: true, action: 'NB źródła', output: out || JSON.stringify(d, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }

    // Long-running actions: stream via NB runner
    if (action === 'report') {
      await handleNbWithProgress(el, 'generate-report', [nbId], 'Generowanie raportu');
      return;
    }
    if (action === 'audio') {
      await handleNbWithProgress(el, 'generate-audio', [nbId], 'Generowanie audio');
      return;
    }
    if (action === 'ask') {
      const question = await showInputDialogValue('Pytanie', 'Zadaj pytanie o źródła...');
      if (!question) return;
      await handleNbWithProgress(el, 'ask', [nbId, question], 'Pytanie do NB');
    }
  }

  // ===========================
  // Competitors
  // ===========================
  function renderCompetitors() {
    const d = telemetryCache;
    if (!d) { loadTelemetry().then(() => renderCompetitors()); return pageSub.textContent = 'Ładowanie...'; }
    const tiles = [];
    const c = d.competitors || {};
    tiles.push({ type:'config', icon:'🏁', label:'Konkurencja łącznie', desc: String(c.total || 0) });
    if (c.total > 0) {
      tiles.push({ type:'nav', icon:'📋', label:'Artykuły konkurencji', desc:'Pełna lista artykułów', gotoLevel:{ level:'competitors-detail' } });
    }
    if (c.total > 0 && c.items) {
      c.items.forEach(item => {
        tiles.push({ type:'config', icon:'📄', label: item.feedName || '—', desc: `${item.articles || 0} artykułów` });
      });
    } else {
      tiles.push({ type:'config', icon:'📭', label:'Brak danych', desc:'Uruchom analizę aby zebrać dane konkurencji' });
    }
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); if (t.gotoLevel) pushLevel(t.gotoLevel); });
  }

  async function renderCompetitorsDetail() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📋</div><div class="result-title">Artykuły konkurencji</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/telemetry/competitors'); data = await r.json(); } catch { data = { error: 'Błąd sieci' }; }
    const tiles = [];
    const items = data.items || [];
    tiles.push({ type:'config', icon:'🏁', label:'Łącznie artykułów konkurencji', desc: String(data.total || 0) });
    if (items.length > 0) {
      items.slice(0, 30).forEach(item => {
        const date = item.date ? new Date(item.date).toLocaleDateString('pl-PL') : '';
        const feed = item.feedName || item.source || '—';
        tiles.push({ type:'config', icon:'📄', label: item.title || '—', desc: `${feed}${date ? ' · ' + date : ''}` });
      });
    } else {
      tiles.push({ type:'config', icon:'📭', label:'Brak artykułów', desc:'Uruchom analyze.mjs aby śledzić konkurencję' });
    }
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  // ===========================
  // Gaps detail
  // ===========================
  function renderGaps() {
    const d = telemetryCache;
    if (!d) { loadTelemetry().then(() => renderGaps()); return pageSub.textContent = 'Ładowanie...'; }
    const tiles = [];
    const g = d.gaps || {};
    const kw = g.topKeywords || [];
    const gaps = g.gaps || [];
    tiles.push({ type:'config', icon:'🔍', label:'Słowa kluczowe', desc: `${kw.length} słów` });
    kw.slice(0, 10).forEach(k => {
      const word = typeof k === 'string' ? k : k.keyword || '';
      const score = typeof k === 'object' ? k.score : '';
      tiles.push({ type:'stat', icon:'🔑', label: word || '—', value: score ? score.toFixed(1) : '—' });
    });
    tiles.push({ type:'config', icon:'📊', label:'Luki tematyczne', desc: `${gaps.length} luk` });
    gaps.slice(0, 10).forEach(k => {
      const word = typeof k === 'string' ? k : k.keyword || '';
      const count = typeof k === 'object' ? k.count : '';
      tiles.push({ type:'stat', icon:'📌', label: word || '—', value: String(count || '') });
    });
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderAnalyzeSummary() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📊</div><div class="result-title">Podsumowanie analizy</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/telemetry/analyze-summary'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    const tiles = [
      { type:'stat', icon:'📄', label:'Artykuły łącznie', value: String(data.articleCount || 0) },
      { type:'stat', icon:'🔑', label:'Unikalne słowa', value: String(data.uniqueWords || 0) },
      { type:'stat', icon:'🔍', label:'Luki tematyczne', value: String(data.gapCount || 0) },
      { type:'stat', icon:'📌', label:'Słowa kluczowe', value: String(data.keywordCount || 0) },
      { type:'config', icon:'📅', label:'Najstarszy artykuł', desc: data.oldestDate ? new Date(data.oldestDate).toLocaleDateString('pl-PL') : '—' },
      { type:'config', icon:'📅', label:'Najnowszy artykuł', desc: data.newestDate ? new Date(data.newestDate).toLocaleDateString('pl-PL') : '—' },
      { type:'back' },
    ];
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderTokenUsage() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔢</div><div class="result-title">Tokeny i zużycie</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/tokens'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    let nbData;
    try { const r = await fetch('/api/nb/telemetry'); nbData = await r.json(); } catch { nbData = {}; }
    const tiles = [
      { type:'stat', icon:'🧠', label:'Modele NVIDIA', value: String(data.ollamaModels || 0) },
      { type:'stat', icon:'📓', label:'Notebooki NB', value: String(nbData.notebooks || data.nbNotebooks || 0) },
      { type:'stat', icon:'📚', label:'Źródła NB', value: String(nbData.totalSources || 0) },
      { type:'stat', icon:'📄', label:'Wygenerowane artykuły', value: String(data.generatedTotal || 0) },
      { type:'stat', icon:'🔄', label:'Aktywne zadania', value: String(data.activeRuns || 0) },
      { type:'config', icon:'💡', label:'NB API', desc: nbData.error ? `Offline: ${nbData.error}` : 'Online' },
      { type:'back' },
    ];
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderQueriesEditor() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔗</div><div class="result-title">Zapytania Google News</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/queries'); data = await r.json(); } catch { data = { pool: [] }; }
    const pool = data.pool || [];
    const tiles = [
      { type:'config', icon:'🔗', label:'Liczba zapytań', desc: String(pool.length) },
      { type:'action', icon:'➕', label:'Dodaj zapytanie', desc:'Dodaj nowe zapytanie do puli', queryAction:'add' },
    ];
    pool.slice(0, 25).forEach((q, i) => {
      tiles.push({ type:'config', icon:'📝', label: q, desc: `#${i + 1} · kliknij aby usunąć` });
    });
    tiles.push({ type:'back' });
    renderTiles(tiles, async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.queryAction === 'add') {
        const text = await showInputDialogValue('Nowe zapytanie', 'Wpisz frazę do wyszukiwania Google News...');
        if (!text) return;
        pool.push(text);
        if (pool.length > 50) pool.shift();
        try {
          await fetch('/api/queries', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pool, _comment: data._comment }) });
          renderQueriesEditor();
        } catch { showToast('Błąd zapisu', 'err'); }
        return;
      }
      if (t.label && pool.includes(t.label)) {
        const newPool = pool.filter(q => q !== t.label);
        try {
          await fetch('/api/queries', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pool: newPool, _comment: data._comment }) });
          renderQueriesEditor();
        } catch { showToast('Błąd usuwania', 'err'); }
      }
    });
  }

  async function renderDownloads() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">⬇️</div><div class="result-title">Pobieranie</div><div class="result-desc">Ładowanie...</div></div>`;
    const tiles = [
      { type:'nav', icon:'📝', label:'Raporty (Research)', desc:'Pobierz raporty z NB Research', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
      { type:'nav', icon:'🎙️', label:'Audio (News)', desc:'Pobierz podcasty z NB News', gotoLevel:{ level:'nb-category', notebookKey:'audio' } },
      { type:'nav', icon:'📰', label:'Digest (News)', desc:'Pobierz digesty', gotoLevel:{ level:'nb-category', notebookKey:'news' } },
      { type:'action', icon:'📦', label:'Wszystkie artifacty', desc:'Lista wszystkich artifactów NB', downloadAction:'list-all' },
      { type:'back' },
    ];
    renderTiles(tiles, async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      if (t.downloadAction === 'list-all') {
        el.classList.add('running');
        try {
          const resp = await fetch('/api/nb/downloads', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ notebookId: '7a31df6c', type:'all' }),
          });
          const data = await resp.json();
          el.classList.remove('running');
          const items = data.items || [];
          if (!items.length) { showToast('Brak artifactów', ''); return; }
          const out = items.map(a => `• [${a.type}] ${a.title || a.id}`).join('\n');
          pushLevel({ level:'result', data: { success:true, action:'NB Artifacts', output: out || JSON.stringify(data) } });
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  async function renderNbConfig() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">⚙</div><div class="result-title">NotebookLM Config</div><div class="result-desc">Ładowanie...</div></div>`;
    let cfg, authStatus;
    try { const r = await fetch('/api/nb/config'); cfg = await r.json(); } catch { cfg = {}; }
    try { const r = await fetch('/api/nb/auth-status'); authStatus = await r.json(); } catch { authStatus = { auth: false, error: 'Błąd sieci' }; }
    const defNb = cfg.defaultNotebook || 'research';
    const nbKeys = Object.keys(NB_NOTEBOOKS);
    const authIcon = authStatus.auth ? '✅' : '❌';
    const authDesc = authStatus.auth
      ? `Zalogowano · ${authStatus.notebooks ?? '?'} notebooków`
      : (authStatus.error || 'Nie zalogowano');
    const tiles = [
      { type:'config', icon:authIcon, label:'Autoryzacja', desc: authDesc },
      { type:'section', icon:'🔐', label:`Zaloguj / Wyloguj` },
      { type:'action', icon:'🔑', label:'Zaloguj się (przez przeglądarkę)', desc:'Otworzy okno logowania Google', nbAuthAction:'login' },
      { type:'action', icon:'🚪', label:'Wyloguj się', desc:'Usuń zapisane ciasteczka', nbAuthAction:'logout' },
      { type:'action', icon:'🔄', label:'Sprawdź auth', desc:'Odśwież status autoryzacji' },
      { type:'section', icon:'⚙️', label:`Ustawienia notebooków` },
      { type:'config', icon:'📓', label:'Domyślny notebook', desc: (NB_NOTEBOOKS[defNb] || {}).title || defNb },
      { type:'config', icon:'🎙️', label:'Styl audio', desc: cfg.audioStyle || 'deep-dive' },
      { type:'config', icon:'🎬', label:'Styl wideo', desc: cfg.videoStyle || 'whiteboard' },
      { type:'toggle', icon:'📡', label:'Auto-push źródeł', desc: cfg.autoPushSources ? 'Tak' : 'Nie', toggled: !!cfg.autoPushSources, nbCfgKey:'autoPushSources' },
      { type:'toggle', icon:'📝', label:'Auto-generuj raport', desc: cfg.autoGenerateReport ? 'Tak' : 'Nie', toggled: !!cfg.autoGenerateReport, nbCfgKey:'autoGenerateReport' },
    ];
    nbKeys.forEach(k => {
      tiles.push({ type:'choice', icon: defNb === k ? '◉' : '○', label: NB_NOTEBOOKS[k].title, value: k, selected: defNb === k, nbCfgKey:'defaultNotebook', nbCfgVal: k });
    });
    tiles.push({ type:'back' });
    renderTiles(tiles, async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.nbCfgKey) {
        if (t.nbCfgKey === 'autoPushSources' || t.nbCfgKey === 'autoGenerateReport') {
          cfg[t.nbCfgKey] = !t.toggled;
        } else {
          cfg[t.nbCfgKey] = t.nbCfgVal;
        }
        try {
          await fetch('/api/nb/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cfg) });
          renderNbConfig();
        } catch { showToast('Błąd zapisu', 'err'); }
        return;
      }
      if (t.nbAuthAction === 'login') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/login', { method:'POST' });
          const d = await r.json();
          el.classList.remove('running');
          if (d.ok) {
            showToast('✅ ' + d.message, '');
            nbAuthed = true;
            updateNbStatusUI();
            setTimeout(() => renderNbConfig(), 2000);
          } else {
            showToast('Błąd: ' + (d.error || 'nieznany'), 'err');
          }
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
        return;
      }
      if (t.nbAuthAction === 'logout') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/logout', { method:'POST' });
          const d = await r.json();
          el.classList.remove('running');
          if (d.ok) { showToast('Wylogowano', ''); nbAuthed = false; updateNbStatusUI(); renderNbConfig(); }
          else { showToast('Błąd: ' + (d.error || 'nieznany'), 'err'); }
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
        return;
      }
      if (t.label === 'Sprawdź auth') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/auth-status');
          const d = await r.json();
          el.classList.remove('running');
          pushLevel({ level:'result', data: { success:d.auth, action:'NB Auth', output: JSON.stringify(d, null, 2) } });
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  async function renderGitStatus() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔀</div><div class="result-title">Git / Deploy</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/git-status'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    const tiles = [
      { type:'config', icon:'🌿', label:'Branch', desc: data.branch || '—' },
      { type:'config', icon:'📝', label:'Ostatni commit', desc: data.lastCommit || '—' },
      { type:'config', icon:'🔍', label:'Google Indexing', desc: data.googleIndexing ? '✅ Skonfigurowany' : '❌ Brak klucza' },
      { type:'config', icon:'💼', label:'LinkedIn', desc: data.linkedin ? '✅ Skonfigurowany' : '❌ Brak tokena' },
      { type:'config', icon:'📋', label:'Ostatnie commity', desc: '' },
    ];
    (data.recentCommits || []).forEach(c => {
      tiles.push({ type:'config', icon:'📌', label: c, desc: '' });
    });
    tiles.push({ type:'action', icon:'🔄', label:'Git push', desc:'Wypchnij zmiany na GitHub', gitAction:'push' });
    tiles.push({ type:'back' });
    renderTiles(tiles, async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gitAction === 'push') {
        el.classList.add('running');
        try {
          const resp = await fetch('/api/git-status');
          el.classList.remove('running');
          showToast('Git status odświeżony — push przez akcję generowania', '');
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  // Auto-watch level with toggles
  function renderAutoWatch() {
    const s = settingsCache;
    const tiles = [
      { type:'config', icon:'', label:'Ustawienia auto-watch', desc: `${s.model || '—'} · ${FORMAT_OPTS[s.format] || s.format} · tryb${s._digest ? '' : ' standard'}` },
      { type:'toggle', icon:'🌙', label:'Tryb digest', desc: s._digest ? 'Wł.' : 'Wył.', toggled: !!s._digest, configKey:'_digest' },
      { type:'toggle', icon:'📬', label:'Newsletter', desc: s._newsletter ? 'Tak' : 'Nie', toggled: !!s._newsletter, configKey:'_newsletter' },
      { type:'toggle', icon:'📝', label:'Szczegółowe logi', desc: s._verbose ? 'Wł.' : 'Wył.', toggled: !!s._verbose, configKey:'_verbose' },
      { type:'action', icon:'▶', label:'Uruchom auto-watch', desc:'Monitoruj feedy i generuj', action:'auto-watch', askPush:true },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.type === 'toggle') {
        settingsCache[t.configKey] = !t.toggled;
        saveSettings(settingsCache);
        renderAutoWatch();
        return;
      }
      if (t.type === 'action') {
        handleActionTile(t, el);
      }
    });
  }

  // ===========================
  // Telemetry
  // ===========================
  let telemetryCache = null;
  let nbTelemetryCache = null;

  async function loadTelemetry() {
    try { const r = await fetch('/api/telemetry'); telemetryCache = await r.json(); updateSidebarStats(); } catch { telemetryCache = null; }
    try { const r = await fetch('/api/nb/telemetry'); nbTelemetryCache = await r.json(); } catch { nbTelemetryCache = null; }
    return telemetryCache;
  }

  function renderTelemetry() {
    if (!telemetryCache) {
      tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📉</div><div class="result-title">Telemetria</div><div class="result-desc">Statystyki i dane</div></div>`;
      loadTelemetry().then(() => renderTelemetry());
      return;
    }
    const d = telemetryCache;
    const nb = nbTelemetryCache;
    const tiles = [];

    // summary tile
    const summaryParts = [];
    if (d.articles) summaryParts.push(`${d.articles.total} artykułów`);
    if (d.feeds) summaryParts.push(`${d.feeds.total} feedów`);
    if (d.competitors) summaryParts.push(`${d.competitors.total} konkurencji`);
    if (d.gaps) summaryParts.push(`${d.gaps.gapCount} luk`);
    tiles.push({ type:'config', icon:'', label:'Podsumowanie', desc: summaryParts.join(' · ') || 'Brak danych' });

    // articles stat
    const a = d.articles || {};
    tiles.push({ type:'stat', icon:'📄', label:'Artykuły łącznie', value: String(a.total || 0) });
    if (a.lastDate) tiles.push({ type:'stat', icon:'📅', label:'Ostatni artykuł', value: new Date(a.lastDate).toLocaleDateString('pl-PL') });

    // month tiles
    if (a.byMonth) {
      const months = Object.entries(a.byMonth).sort((a,b) => a[0].localeCompare(b[0])).slice(-6);
      months.forEach(([m, count]) => {
        const label = new Date(m + '-01').toLocaleDateString('pl-PL', { month:'short', year:'numeric' });
        tiles.push({ type:'stat', icon:'📊', label, value: String(count) });
      });
    }

    // gaps
    if (d.gaps) {
      const kw = (d.gaps.topKeywords || []).map(k => k.keyword || k).join(' · ');
      tiles.push({ type:'config', icon:'🔑', label:'Top słowa kluczowe', desc: kw || '—' });
      tiles.push({ type:'stat', icon:'🔍', label:'Luki tematyczne', value: String(d.gaps.gapCount || 0) });
    }

    // feeds & competitors
    if (d.feeds) {
      const modeParts = Object.entries(d.feeds.byMode || {}).map(([m, c]) => `${m}:${c}`).join(' · ');
      tiles.push({ type:'config', icon:'📡', label:'Feedy', desc: `${d.feeds.total} (${modeParts || '—'})` });
    }
    if (d.competitors) {
      tiles.push({ type:'stat', icon:'🏁', label:'Konkurencja', value: String(d.competitors.total || 0) });
    }

    // notebooklm status
    if (nb) {
      const nbDesc = nb.notebooks ? `${nb.notebooks} notebooków · ${nb.totalSources} źródeł` : nb.error || 'Offline';
      tiles.push({ type:'config', icon:'🧠', label:'NotebookLM', desc: nbDesc });
    } else {
      tiles.push({ type:'config', icon:'🧠', label:'NotebookLM', desc: 'Ładowanie...' });
    }

    // quick links
    tiles.push({ type:'nav', icon:'🔢', label:'Tokeny i zużycie', desc:'Statystyki użycia', gotoLevel:{ level:'token-usage' } });
    tiles.push({ type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium', gotoLevel:{ level:'git-status' } });
    tiles.push({ type:'nav', icon:'⬇️', label:'Pobieranie', desc:'Artifacty NB', gotoLevel:{ level:'downloads' } });

    // recent runs
    const runs = d.runs || [];
    if (runs.length) {
      tiles.push({ type:'config', icon:'🔄', label:'Ostatnie uruchomienia', desc: `${runs.length} wpisów` });
      runs.slice(-8).reverse().forEach(r => {
        const icon = r.success ? '✅' : '❌';
        const elapsed = r.elapsed ? `${r.elapsed.toFixed(1)}s` : '';
        const body = r.bodyLen ? `${r.bodyLen} zn` : '';
        const articles = r.articleCount ? `${r.articleCount} art` : '';
        const date = new Date(r.date).toLocaleString('pl-PL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        tiles.push({ type:'config', icon, label: `${r.action}${elapsed ? ' · ' + elapsed : ''}`, desc: [body, articles, date].filter(Boolean).join(' · ') });
      });
    }

    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') popLevel();
      if (t.gotoLevel) pushLevel(t.gotoLevel);
    });
  }

  // Settings level
  function renderSettings() {
    const s = settingsCache;
    const tiles = [
      { type:'config', icon:'🧠', label:'Model', desc: s.model || '—' },
      { type:'config', icon:'📋', label:'Format', desc: FORMAT_OPTS[s.format] || s.format },
      { type:'config', icon:'👤', label:'Persona', desc: PERSONA_OPTS[s.persona] || s.persona },
      { type:'config', icon:'🎭', label:'Ton', desc: TONE_OPTS[s.tone] || s.tone },
      { type:'config', icon:'🌐', label:'Język', desc: LANG_OPTS[s.lang] || s.lang },
      { type:'config', icon:'🔗', label:'Zapytania (rotacja)', desc: String(s.queries ?? 0) },
      { type:'nav', icon:'📝', label:'Edytor zapytań', desc:'Zarządzaj pulą zapytań Google News', gotoLevel:{ level:'queries-editor' } },
      { type:'nav', icon:'🧠', label:'NB Config', desc:'Konfiguracja NotebookLM', gotoLevel:{ level:'nb-config' } },
      { type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium', gotoLevel:{ level:'git-status' } },
      { type:'nav', icon:'⬇️', label:'Pobieranie', desc:'Artifacty NB do pobrania', gotoLevel:{ level:'downloads' } },
      { type:'action', icon:'🔄', label:'Reset do domyślnych', desc:'Przywróć domyślne ustawienia' },
    ];
    const pickerMap = ['model', 'format', 'persona', 'tone', 'lang'];
    const inputKeys = ['queries'];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      const idx = tiles.indexOf(t);
      if (idx < 5) {
        pushLevel({ level: 'pickers', picker: pickerMap[idx] });
      } else if (idx === 5) {
        showInputDialog('queries');
      } else if (t.label === 'Reset do domyślnych') {
        showResetConfirm();
      }
    });
  }

  // Picker level
  function renderPickers(lvl) {
    const picker = lvl.picker;
    const opts = picker === 'model' ? modelsList.map(m => ({ value: m, label: m }))
      : picker === 'format' ? Object.entries(FORMAT_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'persona' ? Object.entries(PERSONA_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'tone' ? Object.entries(TONE_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'lang' ? Object.entries(LANG_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : [];
    const current = settingsCache[picker] || '';
    const tiles = opts.map(o => ({
      type:'choice', icon: o.value === current ? '◉' : '○', label: o.label, value: o.value, selected: o.value === current,
    }));
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.type === 'choice') {
        settingsCache[picker] = t.value;
        saveSettings(settingsCache);
        popLevel(); // back to settings
      }
    });
  }

  // Result card (Penpot: Generation Complete)
  function renderResult(data) {
    const success = data.success !== false;
    const cancelled = data.error === 'cancel';
    const icon = cancelled ? '⚠️' : success ? '✔️' : '❌';
    const iconClass = cancelled ? 'warn' : success ? 'ok' : 'err';
    const actionLabel = ACTION_LABELS[data.action] || data.action || '';
    const output = data.output || '';
    const isNbResult = ['add-research','generate-report','generate-audio','ask','source-add','source-guide'].includes(data.action);

    // ── NB actions: show research/report/audio/ask/source results ──
    if (isNbResult && success) {
      const titles = { 'add-research':'Research zakończony', 'generate-report':'Raport wygenerowany', 'generate-audio':'Audio wygenerowane', 'ask':'Odpowiedź NB', 'source-add':'Źródło dodane', 'source-guide':'Source Guide' };
      const title = titles[data.action] || 'Operacja NB zakończona';
      const cat = data.category || '';
      const catInfo = cat ? (RESEARCH_CATEGORIES[cat] || { icon:'📊', label:cat }) : null;
      let bodyHtml = '';
      // Try to parse JSON with sources (add-research output)
      try {
        const parsed = JSON.parse(output.trim());
        if (parsed.sources && Array.isArray(parsed.sources)) {
          bodyHtml += '<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">' + (parsed.sources_found || parsed.sources.length) + ' źródeł znalezionych:</div>';
          bodyHtml += '<ul style="list-style:none;padding:0;margin:0 0 12px 0;text-align:left">';
          parsed.sources.slice(0, 20).forEach(s => {
            bodyHtml += '<li style="margin-bottom:4px;font-size:.72rem"><a href="' + esc(s.url) + '" target="_blank" style="color:var(--accent)">🔗 ' + esc(s.title || s.url || '—') + '</a></li>';
          });
          bodyHtml += '</ul>';
        } else if (parsed.answer) {
          bodyHtml += '<div style="text-align:left;font-size:.78rem;line-height:1.6;max-height:300px;overflow-y:auto;white-space:pre-wrap">' + esc(parsed.answer) + '</div>';
        } else {
          bodyHtml += '<div class="progress-output" style="max-height:250px;text-align:left;font-size:.7rem">' + esc(output.slice(0, 2000)) + '</div>';
        }
      } catch {
        bodyHtml += '<div class="progress-output" style="max-height:250px;text-align:left;font-size:.7rem">' + esc(output.slice(0, 2000)) + '</div>';
      }
      tilesEl.innerHTML = `
        <div class="result-card">
          <div class="result-icon ${iconClass}">${icon}</div>
          <div class="result-title">${title}</div>
          ${actionLabel ? '<div class="result-desc">' + actionLabel + '</div>' : ''}
          ${catInfo ? '<div style="display:inline-block;background:var(--accent);color:#fff;font-size:.65rem;padding:2px 8px;border-radius:10px;margin-bottom:8px">' + catInfo.icon + ' ' + catInfo.label + '</div>' : ''}
          ${bodyHtml}
          <div style="display:flex;gap:8px;justify-content:center;margin-top:1rem">
            <button class="result-btn primary" id="resultNew">🔄  Nowy research</button>
            <button class="result-btn" id="resultBack2">↩  Powrót</button>
          </div>
        </div>`;
      document.getElementById('resultNew').addEventListener('click', () => {
        navStack = navStack.filter(l => l.level !== 'result');
        if (navStack.length > 1) { navStack.pop(); render(); }
        else popLevel();
      });
      document.getElementById('resultBack2').addEventListener('click', popLevel);
      return;
    }

    // ── NB error display ──
    if (isNbResult && !success) {
      tilesEl.innerHTML = `
        <div class="result-card">
          <div class="result-icon err">❌</div>
          <div class="result-title">Błąd NotebookLM</div>
          ${actionLabel ? '<div class="result-desc">' + actionLabel + '</div>' : ''}
          <div class="progress-output" style="max-height:250px;text-align:left;font-size:.7rem">${esc(data.error || output.slice(0, 1500))}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:1rem">
            <button class="result-btn" id="resultBack2">↩  Powrót</button>
          </div>
        </div>`;
      document.getElementById('resultBack2').addEventListener('click', popLevel);
      return;
    }

    // ── Article generation: check for structured genResult first ──
    var genResult = data.genResult;
    if (genResult && genResult.title) {
      var grTitle = genResult.title || '';
      var grSlug = genResult.slug || '';
      var grWords = String(genResult.words || 0);
      var grTime = String(genResult.time || '');
      var grReadability = genResult.readability || '';
      var grFile = genResult.file || '';
      var grUrl = genResult.url || '';
      var grModel = genResult.model || 'nvidia/llama-3.3-nemotron-super-49b-v1';
      var grSizeKB = genResult.sizeKB || '';
      var grH2 = String(genResult.h2count || 0);

      var grPreview = grTitle + '\n' + grWords + ' słów · ' + grReadability + ' · ' + grTime + 's';

      tilesEl.innerHTML = '' +
        '<div class="result-card">' +
          '<div class="result-icon ok">✔️</div>' +
          '<div class="result-title">Artykuł wygenerowany</div>' +
          '<div class="result-desc">' + esc(grTitle.slice(0, 80)) + '</div>' +
          '<div class="article-preview">' +
            '<div class="article-preview-title">' + esc(grTitle) + '</div>' +
            '<div class="article-preview-meta">' +
              '<span>📝 ' + grWords + ' słów</span>' +
              '<span>📖 ' + grReadability + '</span>' +
              '<span>📏 ' + grSizeKB + ' KB</span>' +
              '<span>🤖 ' + esc(grModel) + '</span>' +
              '<span>⏱ ' + grTime + 's</span>' +
            '</div>' +
            '<div class="article-preview-slug">articles/' + esc(grSlug) + '.html</div>' +
            (grFile ? '<a class="result-link" href="/' + esc(grFile).replace(/\\/g,"/") + '" target="_blank">📎 Otwórz artykuł</a>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;flex-wrap:wrap">' +
            (grFile ? '<a class="result-link" href="/' + esc(grFile).replace(/\\/g,"/") + '" target="_blank">📎 Otwórz artykuł</a>' : '') +
            (grFile ? '<button class="result-btn" id="resultPush" style="margin:0 4px">📤 Push do KROKIET NEWS</button>' : '') +
            '<button class="result-btn" id="resultBack">🔄 Generuj kolejny</button>' +
            '<button class="result-btn" id="resultBack2">↩ Powrót</button>' +
          '</div>' +
        '</div>';
      var backBtn = document.getElementById('resultBack');
      var backBtn2 = document.getElementById('resultBack2');
      if (backBtn) backBtn.addEventListener('click', function() {
        if (navStack.length > 2) { navStack = navStack.slice(0, navStack.length - 2); render(); }
        else popLevel();
      });
      if (backBtn2) backBtn2.addEventListener('click', popLevel);
      var pushBtn = document.getElementById('resultPush');
      if (pushBtn) pushBtn.addEventListener('click', () => doPush(grFile, grSlug));
      return;
    }

    // ── Article generation: legacy behavior (extract from text) ──
    const title = cancelled ? 'Przerwano' : success ? 'Artykuł wygenerowany' : 'Błąd';
    const hasFile = data.file && !cancelled;

    // Extract article info from output
    let artTitle = '', artSlug = '', artWords = '', artTime = '', artDate = '', artSize = '', artH2 = '';
    const titleM = output.match(/(?:→|artTitle:)\s*(.+?)(?:\s*[|·]\s*|$)/m);
    const slugM = output.match(/(?:slug|articles[\\/])([\w-]+)/);
    const wordsM = output.match(/Body:\s*(\d+)\s*zn/);
    const h2M = output.match(/\b(\d+)\s*H2/);
    const sizeM = output.match(/([\d.]+)\s*KB/);
    const dateM = output.match(/(\d{2}\.\d{2}\.\d{4})/);
    const timeM = output.match(/(?:min czytania|min read).*?(\d+)/i);
    if (titleM) artTitle = titleM[1].trim();
    if (slugM) artSlug = slugM[1];
    if (wordsM) artWords = wordsM[1];
    if (h2M) artH2 = h2M[1];
    if (sizeM) artSize = sizeM[1];
    if (dateM) artDate = dateM[1];
    if (timeM) artTime = timeM[1];

    const preview = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(l => l.trim() && !l.startsWith('{') && !l.includes('═══') && !l.includes('───')).slice(-6).join('\n').substring(0, 400);

    let actionButtons = '';
    if (success) {
      if (hasFile) actionButtons += `<a class="result-link" href="/${data.file}" target="_blank">📎  Otwórz artykuł</a>`;
      if (hasFile) actionButtons += `<button class="result-btn" id="resultPush" style="margin:0 4px">📤  Push do KROKIET NEWS</button>`;
      actionButtons += `<button class="result-btn primary" id="resultBack" style="margin:0 4px">🔄  Generuj kolejny</button>`;
    }
    actionButtons += `<button class="result-btn" id="resultBack2">↩  Powrót</button>`;

    const statsHtml = (artWords || artSize || artH2 || artTime)
      ? `<div class="stats-row">
          ${artWords ? `<div class="stat-item"><div class="stat-val">${artWords}</div><div class="stat-lbl">słów</div></div>` : ''}
          ${artH2 ? `<div class="stat-item"><div class="stat-val">${artH2}</div><div class="stat-lbl">sekcji H2</div></div>` : ''}
          ${artSize ? `<div class="stat-item"><div class="stat-val">${artSize}</div><div class="stat-lbl">KB HTML</div></div>` : ''}
          ${artTime ? `<div class="stat-item"><div class="stat-val">${artTime}</div><div class="stat-lbl">min czyt.</div></div>` : ''}
        </div>`
      : '';

    const previewHtml = (success && (artTitle || artSlug))
      ? `<div class="article-preview">
          <div class="article-preview-title">${artTitle || artSlug.replace(/-/g, ' ')}</div>
          <div class="article-preview-meta">${artDate ? '<span>📅 '+artDate+'</span>' : ''}${artTime ? '<span>📖 '+artTime+' min</span>' : ''}<span>🤖 ${esc(window._genModel || 'nvidia/llama-3.3-nemotron-super-49b-v1')}</span></div>
          <div class="article-preview-body">${preview.split('\n').filter(l=>l.length>20).slice(0,1)[0] || 'Treść wygenerowana pomyślnie...'}</div>
          ${artSlug ? `<div class="article-preview-slug">articles/${artSlug}.html</div>` : ''}
        </div>`
      : '';

    tilesEl.innerHTML = `
      <div class="result-card">
        <div class="result-icon ${iconClass}">${icon}</div>
        <div class="result-title">${title}</div>
        ${actionLabel ? `<div class="result-desc">${actionLabel}</div>` : ''}
        ${statsHtml}
        ${previewHtml}
        ${!success ? `<div class="progress-output" style="max-height:200px">${preview}</div>` : ''}
        <div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;flex-wrap:wrap">
          ${actionButtons}
        </div>
      </div>`;
    backBtn = document.getElementById('resultBack');
    var backBtn2 = document.getElementById('resultBack2');
    if (backBtn) backBtn.addEventListener('click', () => {
      // Go back two levels: result → action level
      if (navStack.length > 2) { navStack = navStack.slice(0, navStack.length - 2); render(); }
      else popLevel();
    });
    if (backBtn2) backBtn2.addEventListener('click', popLevel);
    var pushBtn = document.getElementById('resultPush');
    if (pushBtn) pushBtn.addEventListener('click', () => doPush(data.file, artSlug || (data.file || '').split(/[\\/]/).pop()));
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function doPush(file, slug) {
    const btn = document.getElementById('resultPush');
    if (btn) { btn.disabled = true; btn.textContent = '📤  Pushowanie...'; }
    fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: 'articles/ generated.json', message: 'Add: ' + (slug || file || '').slice(0, 60) }),
    })
      .then(r => r.json())
      .then(res => {
        if (btn) { btn.disabled = false; btn.textContent = res.ok ? '✅  Pushnięte' : '📤  Push do KROKIET NEWS'; }
        showToast(res.ok ? '✅ Pushnięte na GitHub' : '❌ ' + (res.error || 'Błąd push'), res.ok ? '' : 'err');
      })
      .catch(e => {
        if (btn) { btn.disabled = false; btn.textContent = '📤  Push do KROKIET NEWS'; }
        showToast('❌ Błąd sieci: ' + e.message, 'err');
      });
  }
  // ===========================
  // Live Progress view (Penpot 8-step design)
  // ===========================
  function renderProgress(data) {
    tilesEl.style.display = 'block';
    const label = data.label || '';
    const startTime = Date.now();

    // NB operations: simple log view with live output
    if (data.action === 'nb-run') {
      const nbActionLabel = label || 'Operacja NB';
      const estTimes = { 'add-research':'do 5 min', 'generate-report':'do 5 min', 'generate-audio':'do 10 min', 'ask':'do 3 min' };
      const estLabel = estTimes[data.nbAction] || '';
      tilesEl.innerHTML = `
        <div class="result-card" id="progressCard" style="padding:1.5rem 1rem;">
          <div class="result-title" id="progressTitle">${nbActionLabel}</div>
          <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.4rem" id="progressTimer">⏱ 0s${estLabel ? ' · ' + estLabel : ''}</div>
          <div class="nb-heartbeat" id="nbHeartbeat" style="text-align:center;font-size:.7rem;color:var(--text-muted);margin-bottom:.5rem">⏳ Oczekiwanie na odpowiedź NotebookLM...</div>
          <div class="progress-output" id="progressOutput" style="max-height:350px;margin:0 auto 1rem;width:100%;max-width:620px;font-size:.72rem"></div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:.8rem">
            <button class="result-btn" id="progressCancel">✕  Anuluj</button>
          </div>
        </div>`;
      const timerEl = document.getElementById('progressTimer');
      const timerInterval = setInterval(() => {
        if (!timerEl || !document.getElementById('progressCard')) { clearInterval(timerInterval); return; }
        timerEl.textContent = `⏱ ${Math.floor((Date.now() - startTime) / 1000)}s`;
      }, 1000);
      if (running) running._progressTimer = timerInterval;
      const cancelBtn = document.getElementById('progressCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => {
        if (running) doCancel();
        popLevel();
      });
      return;
    }

    // ── New article generation view ──
    const phases = [
      { id:'warmup', icon:'🔄', label:'Sprawdzanie NVIDIA', desc:'Test połączenia z NVIDIA API...' },
      { id:'generating', icon:'✍️', label:'Pisanie artykułu', desc:'AI generuje treść — live preview poniżej' },
      { id:'publish', icon:'🚀', label:'Publikacja', desc:'Zapis HTML, Git push, indeksacja' },
    ];

    tilesEl.innerHTML = '' +
      '<div class="gen-wrap" id="genWrap">' +
        '<div class="gen-config" id="genConfig">' +
          '<span id="genFormat" class="gen-badge">—</span>' +
          '<span id="genPersona" class="gen-badge gen-badge-dim">—</span>' +
          '<span id="genModel" class="gen-badge gen-badge-model">—</span>' +
        '</div>' +
        '<div class="gen-title-line" id="genTitleLine" style="display:none">"<span id="genTopic"></span>"</div>' +
        '<div class="gen-phases" id="genPhases">' +
          phases.map(function(p,i) { return '' +
            '<div class="gen-phase' + (i===0?' active':'') + '" data-phase="' + p.id + '">' +
              '<div class="gen-phase-dot">' + (i+1) + '</div>' +
              '<div class="gen-phase-label">' + p.icon + ' ' + p.label + '</div>' +
              '<div class="gen-phase-desc">' + p.desc + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="gen-bar-wrap"><div class="gen-bar-fill" id="genBar"></div></div>' +
        '<div class="gen-status" id="genStatus">🔄 Sprawdzanie NVIDIA API...</div>' +
        '<div class="gen-preview-wrap" id="genPreviewWrap">' +
          '<div class="gen-preview-empty" id="genPreviewEmpty">Artykuł pojawi się tutaj w czasie rzeczywistym...</div>' +
          '<div class="gen-preview-text" id="genPreviewText"></div>' +
          '<span class="gen-cursor" id="genCursor">▌</span>' +
        '</div>' +
        '<div class="gen-metrics" id="genMetrics">' +
          '<span id="genTimer">⏱ 0s</span>' +
          '<span id="genWords" style="display:none">0 słów</span>' +
        '</div>' +
        '<button class="gen-cancel-btn" id="genCancel">✕ Anuluj (Esc)</button>' +
      '</div>';

    // Timer
    var timerEl2 = document.getElementById('genTimer');
    var timerInterval2 = setInterval(function() {
      if (!timerEl2 || !document.getElementById('genWrap')) { clearInterval(timerInterval2); return; }
      timerEl2.textContent = '⏱ ' + Math.floor((Date.now() - startTime) / 1000) + 's';
    }, 1000);
    if (running) running._progressTimer = timerInterval2;

    document.getElementById('genCancel').addEventListener('click', function() {
      if (running) doCancel();
      popLevel();
    });

    // Esc key
    var escHandler = function(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); if (running) doCancel(); popLevel(); } };
    document.addEventListener('keydown', escHandler);
    running._escHandler = escHandler;

    window._genText = '';
    window._genPreviewShown = false;
  }

  function renderProgressLive(payload) {
    // If it's raw text (legacy mode), try to extract events from it
    if (typeof payload === 'string') {
      var outEl = document.getElementById('progressOutput');
      if (!outEl) return;
      var clean = payload.replace(/\x1b\[[0-9;]*m/g, '');
      outEl.textContent = clean || '⌛  Oczekiwanie...';
      outEl.scrollTop = outEl.scrollHeight;
      return;
    }
    // Structured events from JSON-output mode
    handleGenEvent(payload);
  }

  function handleGenEvent(evt) {
    if (!evt || !evt.type) return;

    if (evt.type === 'meta') {
      var fmtEl = document.getElementById('genFormat');
      var perEl = document.getElementById('genPersona');
      var mdlEl = document.getElementById('genModel');
      if (evt.model) window._genModel = evt.model;
      if (fmtEl) fmtEl.textContent = (FORMAT_OPTS[evt.format] || evt.format || '—').toUpperCase();
      if (perEl) perEl.textContent = (PERSONA_OPTS[evt.persona] || evt.persona || '—');
      if (mdlEl) mdlEl.textContent = evt.model || window._genModel || '—';
      return;
    }

    if (evt.type === 'phase') {
      var phaseMap = {
        rss_fetch:'warmup', model_select:'warmup', dir_check:'warmup', prompt_build:'warmup',
        warmup:'warmup', generating:'generating',
        build_html:'publish', save_file:'publish', mark_gen:'publish', reindex:'publish',
        nb_sync:'publish', publish:'publish', done:'publish',
      };
      var target = phaseMap[evt.phase] || 'warmup';
      updateGenPhases(target);
      // Phase transition messages
      var statusEl = document.getElementById('genStatus');
      var messages = {
        warmup:'🔄 Sprawdzanie NVIDIA API...',
        generating:'✍️ AI pisze artykuł...',
        publish:'📦 Zapis i publikacja...',
      };
      if (statusEl) statusEl.textContent = messages[target] || evt.label || '';
      if (target === 'generating') {
        var bar = document.getElementById('genBar');
        if (bar) bar.style.width = '50%';
      }
      if (target === 'publish') {
        var bar2 = document.getElementById('genBar');
        if (bar2) bar2.style.width = '90%';
      }
      return;
    }

    if (evt.type === 'warmup_tick') {
      var st = document.getElementById('genStatus');
      if (st) st.textContent = '🔄 Ładowanie modelu do RAM... (' + evt.elapsed + 's)';
      return;
    }

    if (evt.type === 'warmup_done') {
      var st2 = document.getElementById('genStatus');
      if (st2) st2.textContent = '✅ Model załadowany — rozpoczynam pisanie...';
      updateGenPhases('generating');
      var bar3 = document.getElementById('genBar');
      if (bar3) bar3.style.width = '45%';
      return;
    }

    if (evt.type === 'token') {
      window._genText = (window._genText || '') + (evt.text || '');
      var previewText = document.getElementById('genPreviewText');
      var previewEmpty = document.getElementById('genPreviewEmpty');
      var cursor = document.getElementById('genCursor');
      if (previewText) {
        if (!window._genPreviewShown && window._genText.length > 20) {
          window._genPreviewShown = true;
          if (previewEmpty) previewEmpty.style.display = 'none';
        }
        previewText.textContent = window._genText;
        previewText.scrollTop = previewText.scrollHeight;
      }
      if (cursor) cursor.style.display = 'inline';
      // Estimate word count
      var wc = window._genText.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      var wordsEl = document.getElementById('genWords');
      if (wordsEl && wc > 5) {
        wordsEl.style.display = 'inline';
        wordsEl.textContent = wc + ' słów';
      }
      return;
    }

    if (evt.type === 'info') {
      var st3 = document.getElementById('genStatus');
      if (st3 && evt.msg) {
        if (evt.tag === 'git') st3.textContent = (evt.color === 'red' ? '❌ ' : '') + evt.msg;
        else st3.textContent = evt.msg;
      }
      return;
    }

    if (evt.type === 'error') {
      var st4 = document.getElementById('genStatus');
      if (st4) st4.textContent = '❌ ' + (evt.msg || 'Błąd generowania');
      return;
    }

    if (evt.type === 'done') {
      // Stash for result view
      if (evt.title) window._genResult = evt;
      var bar4 = document.getElementById('genBar');
      if (bar4) bar4.style.width = '100%';
      updateGenPhases('publish');
      var st5 = document.getElementById('genStatus');
      if (st5) st5.textContent = '✅ Gotowe! ' + (evt.words || '') + ' słów · ' + (evt.readability || '');
      var wordsEl2 = document.getElementById('genWords');
      if (wordsEl2) { wordsEl2.style.display = 'inline'; wordsEl2.textContent = (evt.words || 0) + ' słów'; }
      return;
    }
  }

  function updateGenPhases(activeId) {
    var all = document.querySelectorAll('.gen-phase');
    var ids = ['warmup', 'generating', 'publish'];
    var activeIdx = ids.indexOf(activeId);
    all.forEach(function(el, i) {
      el.classList.remove('active', 'done');
      if (i < activeIdx) el.classList.add('done');
      else if (i === activeIdx) el.classList.add('active');
    });
  }

  // ===========================
  // Warmup handler
  // ===========================
  async function handleWarmup(el) {
    if (running) { showToast('Poczekaj na zakończenie zadania', 'err'); return; }
    el.classList.add('running');
    showToast('🔥 Warmup — sprawdzam połączenie z NVIDIA API...', '');
    
    const es = new EventSource('/api/warmup');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') return;
        if (msg.done) {
          es.close();
          el.classList.remove('running');
          const success = msg.success !== false;
          showToast(success ? '✅ NVIDIA API OK — gotowy do pracy!' : '❌ ' + (msg.error || 'Błąd'), success ? '' : 'err');
          return;
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      showToast('Połączenie przerwane', 'err');
      el.classList.remove('running');
    };
  }

  // ===========================
  // Handle action tile click
  // ===========================
  async function handleActionTile(t, el) {
    // Add topic manually
    if (t.action === 'add-topic') {
      const input = await showInputDialogValue(t.inputLabel || 'URL lub tytuł', t.inputPlaceholder || '');
      if (!input) return;
      el.classList.add('running');
      try {
        const resp = await fetch('/api/topics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: input, url: input.startsWith('http') ? input : '', source: 'manual' }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.ok) { showToast('✅ Dodano temat do kolejki', ''); } else { showToast('Błąd: ' + (data.error || 'nieznany'), 'err'); }
      } catch (e) { el.classList.remove('running'); showToast('Błąd sieci: ' + e.message, 'err'); }
      return;
    }
    // NB Web Research — direct research from RSS panel
    if (t.action === 'nb-web-research') {
      const category = await showCategoryPicker();
      if (!category) return;
      const query = await showInputDialogValue('NB Web Research', 'Czego szukać...');
      if (!query) return;
      const catInfo = RESEARCH_CATEGORIES[category] || { icon:'📊', label:category };
      const catTag = catInfo.icon + ' ' + catInfo.label;
      let fullQuery = query;
      try {
        const spResp = await fetch('/api/nb/init-context', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const spData = await spResp.json();
        if (spData.ok && spData.content) {
          fullQuery = spData.content + '\n\n--- Kategoria: ' + catTag + ' ---\n--- Pytanie użytkownika ---\n' + query;
        }
      } catch {}
      await handleNbWithProgress(el, 'add-research', [NB_NOTEBOOKS.research.id, fullQuery, '--mode', 'deep'], 'Research: ' + catTag, category);
      return;
    }
    // NB Digest — quick summary or report from News notebook
    if (t.action === 'nb-digest') {
      const choice = await showChoice('NB Digest — News Notebook', 'Co chcesz zrobić?',
        { label:'📄 Podsumowanie', value:'summary' },
        { label:'📝 Generuj raport', value:'report' }
      );
      if (!choice) return;
      const newsId = NB_NOTEBOOKS.news.id;
      if (choice === 'summary') {
        el.classList.add('running');
        try {
          const r = await fetch(`/api/nb/notebooks/${newsId}/summary`);
          const d = await r.json();
          el.classList.remove('running');
          if (d.error) { showToast('Błąd: ' + d.error, 'err'); return; }
          pushLevel({ level:'result', data:{ success:true, action:'nb-digest', label:'News Digest', output: d.output || JSON.stringify(d,null,2) } });
        } catch(e) { el.classList.remove('running'); showToast('Błąd sieci: '+e.message,'err'); }
      } else {
        await handleNbWithProgress(el, 'generate-report', [newsId, '--format', 'digest'], 'News Digest Report');
      }
      return;
    }
    if (t.action === 'rss-pick') {
      pushLevel({ level: 'rss-feed-picker-gen' });
      return;
    }
    // Queue / research / gap / batch generation
    if (['generate-from-queue','generate-from-research','generate-from-gap','process-queue','regenerate-index'].includes(t.action)) {
      let fmtOverride = null;
      if (t.action !== 'regenerate-index') {
        fmtOverride = await showFormatPicker();
        if (fmtOverride === null) return;
      }
      el.classList.add('running');
      const body = { push: false };
      if (fmtOverride && fmtOverride !== 'default') {
        body.format = fmtOverride.format;
        body.persona = fmtOverride.persona;
      }
      body.digest = !!settingsCache._digest;
      body.newsletter = !!settingsCache._newsletter;
      body.verbose = !!settingsCache._verbose;
      try {
        const resp = await fetch(`/api/run/${t.action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        const data = await resp.json();
        if (!data.ok) { showToast(`Błąd: ${data.error}`, 'err'); el.classList.remove('running'); return; }
        running = { tileAction: { label: t.label }, el, output: '' };
        pushLevel({ level: 'progress', data: { action: t.action, label: t.label } });
        const es = new EventSource(`/api/run/${data.runId}/stream`);
        running.es = es; running.runId = data.runId;
        es.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
          if (msg.type === 'connected') return;
          if (msg.type === 'heartbeat') {
            const hb = document.getElementById('nbHeartbeat');
            if (hb) { hb.textContent = '⏳ Oczekiwanie na odpowiedź NotebookLM...'; setTimeout(() => { if (hb) hb.textContent = '⏳ Oczekiwanie na odpowiedź NotebookLM...'; }, 400); }
            return;
          }
            if (msg.done) {
              es.close(); el.classList.remove('running');
              if (running && running._progressTimer) clearInterval(running._progressTimer);
              if (running && running._escHandler) document.removeEventListener('keydown', running._escHandler);
              addJobToQueue(t.label, msg.error ? 'error' : 'done', msg.output);
              running = null;
              navStack = navStack.filter(l => l.level !== 'progress');
              const success = !msg.error;
              var gr2 = window._genResult; window._genResult = null;
              if (t.action === 'regenerate-index') {
                showToast(success ? '✅ Indeks odświeżony pomyślnie' : '❌ Błąd odświeżania indeksu', success ? '' : 'err');
              } else if (success) {
                showToast('✅ Zadanie zakończone', '');
              } else {
                showToast('❌ ' + (msg.error || 'Błąd'), 'err');
              }
              pushLevel({ level: 'result', data: { success, error: msg.error, action: t.action, output: msg.output || '', genResult: gr2 || null } });
              return;
            }
          if (msg.type === 'event' && msg.event) {
            if (currentLevel().level === 'progress') renderProgressLive(msg.event);
          } else if (msg.data) {
            running.output = (running.output || '') + msg.data;
            if (currentLevel().level === 'progress') renderProgressLive(running.output);
          }
          } catch {}
        };
        es.onerror = () => { es.close(); showToast('Utracono połączenie z serwerem', 'err'); el.classList.remove('running'); if (running && running._progressTimer) clearInterval(running._progressTimer); running = null; navStack = navStack.filter(l => l.level !== 'progress'); render(); };
      } catch (e) { el.classList.remove('running'); showToast('Błąd sieci: ' + e.message, 'err'); }
      return;
    }

    // if already running, ask to cancel
    if (running) {
      const ok = await showConfirm('Przerwać?', 'Zadanie jest w trakcie. Przerwać?', 'Przerwij', 'Kontynuuj');
      if (ok) await doCancel();
      return;
    }
    let input = null;

    // input dialog
    if (t.needsInput) {
      input = await showInputDialogValue(t.inputLabel || 'Wprowadź dane', t.inputPlaceholder || '', t.inputDefault);
      if (input === null) return;
    }

    // push question for content tiles
    let pushFlag = true;
    if (t.askPush) {
      pushFlag = await showChoice('Push na gita?', 'Wypushować zmiany na GitHub?', { label:'Nie', value: false }, { label:'Tak', value: true });
      if (pushFlag === null) return;
    }

    el.classList.add('running');

    const body = { push: pushFlag };
    if (t.needsInput && input) {
      if (t.action === 'rss') body.url = input;
      else body.topic = input;
    }
    body.digest = !!settingsCache._digest;
    body.newsletter = !!settingsCache._newsletter;
    body.verbose = !!settingsCache._verbose;

    try {
      const resp = await fetch(`/api/run/${t.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!data.ok) {
        showToast(`Błąd: ${data.error}`, 'err');
        el.classList.remove('running');
        running = null;
        return;
      }

      // Show progress view immediately (before setting running to avoid pushLevel guard)
    running = { tileAction: t, el, output: '' };
    pushLevel({ level: 'progress', data: { action: t.action, label: t.label || t.action } });

    // start SSE
    const es = new EventSource(`/api/run/${data.runId}/stream`);
      running.es = es;
      running.runId = data.runId;

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'connected') return;
          if (msg.done) {
            es.close();
            el.classList.remove('running');
            if (running && running._progressTimer) clearInterval(running._progressTimer);
            if (running && running._escHandler) document.removeEventListener('keydown', running._escHandler);
            addJobToQueue(running?.tileAction?.label || 'Zadanie', msg.error ? 'error' : 'done', msg.output);
            running = null;
            const out = msg.output || '';
            var gr = window._genResult; window._genResult = null;
            if (gr && gr.title) {
              navStack = navStack.filter(l => l.level !== 'progress');
              pushLevel({ level: 'result', data: { success: !msg.error, error: msg.error, action: t.action, genResult: gr, output: out } });
            } else {
              const fileMatch = out.match(/(?:output[/\\])[^\s\n]+\.(?:md|json|html)/i) || out.match(/(?:do|:|→)\s*([^\s\n]+\.(?:md|json|html|txt))/i);
              navStack = navStack.filter(l => l.level !== 'progress');
              pushLevel({ level: 'result', data: { success: !msg.error, error: msg.error, action: t.action, output: out, file: fileMatch ? (fileMatch[1] || fileMatch[0]).trim() : null } });
            }
            return;
          }
          // Live update: accumulate output and re-render progress
          if (msg.type === 'event' && msg.event) {
            if (currentLevel().level === 'progress') renderProgressLive(msg.event);
          } else if (msg.data) {
            running.output = (running.output || '') + msg.data;
            if (currentLevel().level === 'progress') renderProgressLive(running.output);
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        showToast('Utracono połączenie z serwerem', 'err');
        el.classList.remove('running');
        if (running && running._progressTimer) clearInterval(running._progressTimer);
        running = null;
        // Pop progress level on error
        navStack = navStack.filter(l => l.level !== 'progress');
        render();
      };
    } catch (e) {
      showToast(`Błąd sieci: ${e.message}`, 'err');
      el.classList.remove('running');
      running = null;
    }
  }

  async function doCancel() {
    const r = running;
    if (!r) return;
    if (r.es) r.es.close();
    if (r._progressTimer) clearInterval(r._progressTimer);
    if (r.runId) {
      try { await fetch(`/api/run/${r.runId}/cancel`, { method: 'POST' }); } catch {}
    }
    if (r.el) r.el.classList.remove('running');
    running = null;
    showToast('Przerwano');
  }

  // ===========================
  // Dialog system
  // ===========================
  let dialogResolve = null;

  function showDialog(title, htmlContent, actions) {
    return new Promise(resolve => {
      dialogResolve = resolve;
      dialogTitle.textContent = title;
      dialogBody.innerHTML = htmlContent;
      dialogActions.innerHTML = '';
      actions.forEach(a => {
        const btn = document.createElement('button');
        btn.className = `dialog-btn dialog-btn-${a.style || 'secondary'}`;
        btn.textContent = a.label;
        btn.addEventListener('click', () => { resolve(a.value); closeDialog(); });
        dialogActions.appendChild(btn);
      });
      dialog.classList.add('open');
      dialogOverlay.classList.add('open');
      requestAnimationFrame(() => { const f = dialog.querySelector('button, input, select, textarea'); if (f) f.focus(); trapFocus(dialog); });
    });
  }

  function closeDialog() {
    dialog.classList.remove('open');
    dialogOverlay.classList.remove('open');
    dialogResolve = null;
  }

  function trapFocus(container) {
    const focusable = container.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    container.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dialog.classList.contains('open')) {
      if (dialogResolve) dialogResolve(null);
      closeDialog();
    }
  });
  dialogOverlay.addEventListener('click', () => {
    if (dialogResolve) dialogResolve(null);
    closeDialog();
  });

  function showInputDialogValue(label, placeholder, defaultValue) {
    return showDialog(label, `<label style="display:block;font-size:.85rem;color:var(--text-dim);margin-bottom:8px">${label}</label><textarea class="dialog-textarea" id="dialogInput" placeholder="${placeholder}" rows="3"></textarea>`, [
      { label:'Anuluj', style:'secondary', value: null },
      { label:'Uruchom', style:'primary', value: 'ok' },
    ]).then(val => {
      if (val === null) return null;
      const inp = document.getElementById('dialogInput');
      return inp.value.trim() || defaultValue || '';
    });
  }

  function showInputDialog(key) {
    const labelMap = { queries:'Zapytania (rotacja) — oddzielone przecinkami' };
    const current = settingsCache[key] ?? '';
    showDialog(labelMap[key] || key, `<label style="display:block;font-size:.85rem;color:var(--text-dim);margin-bottom:8px">${labelMap[key] || key}</label><textarea class="dialog-textarea" id="dialogInput" rows="2">${current}</textarea>`, [
      { label:'Anuluj', style:'secondary', value: null },
      { label:'Zapisz', style:'primary', value: 'ok' },
    ]).then(val => {
      if (val === null) return;
      const inp = document.getElementById('dialogInput');
      const v = inp.value.trim();
      settingsCache[key] = key === 'queries' ? (parseInt(v,10) || 0) : v;
      saveSettings(settingsCache);
      renderSettings();
    });
  }

  function showConfirm(title, message, okLabel, cancelLabel) {
    return showDialog(title, `<p style="line-height:1.7;margin-bottom:0">${message}</p>`, [
      { label: cancelLabel || 'Anuluj', style: 'secondary', value: null },
      { label: okLabel || 'Uruchom', style: 'primary', value: true },
    ]);
  }

  function showChoice(title, message, optA, optB) {
    return showDialog(title, `<p style="line-height:1.7;margin-bottom:0">${message}</p>`, [
      { label: optA.label, style: optA.style || 'secondary', value: optA.value },
      { label: optB.label, style: optB.style || 'primary', value: optB.value },
    ]);
  }

  function showResetConfirm() {
    showConfirm('Przywróć domyślne', 'Czy na pewno przywrócić domyślne ustawienia?', 'Przywróć', 'Anuluj').then(ok => {
      if (!ok) return;
      settingsCache = { model:'nvidia/llama-3.3-nemotron-super-49b-v1', format:'article', persona:'journalist', tone:'casual', lang:'pl', queries:0 };
      delete settingsCache._digest;
      delete settingsCache._newsletter;
      delete settingsCache._verbose;
      saveSettings(settingsCache);
      renderSettings();
    });
  }

  // ===========================
  // Toast
  // ===========================
  let toastTimer;
  function showToast(msg, type) {
    toast.textContent = msg;
    toast.style.borderColor = type === 'err' ? 'var(--error)' : 'var(--green)';
    toast.style.color = type === 'err' ? 'var(--error)' : 'var(--green)';
    toast.style.boxShadow = type === 'err' ? '0 0 15px rgba(239,68,68,.2)' : '';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function showCategoryPicker() {
    const cats = Object.entries(RESEARCH_CATEGORIES).map(([key, val]) => ({
      label: val.icon + ' ' + val.label, style: 'secondary', value: key,
    }));
    return showDialog('Wybierz kategorię', '<p style="font-size:.8rem;color:var(--text-dim);margin-bottom:.5rem">Kategoria określa kontekst wyszukiwania w systemprompcie</p>', cats);
  }

  function showFormatPicker() {
    const fmtOpts = Object.entries(FORMAT_OPTS).map(([k, v]) => ({ label: v, style: 'secondary', value: k }));
    const perOpts = Object.entries(PERSONA_OPTS).map(([k, v]) => ({ label: v, style: 'secondary', value: k }));
    const curFmt = settingsCache.format || 'article';
    const curPer = settingsCache.persona || 'journalist';
    const id = 'fmt_' + Date.now();
    const html = `
      <p style="font-size:.75rem;color:var(--text-dim);margin-bottom:6px">Format: <span id="${id}_fmtlbl">${FORMAT_OPTS[curFmt]}</span></p>
      <div id="${id}_fmtg" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">
        ${fmtOpts.map(f => `<button class="feed-chip ${curFmt===f.value?'active':''}" onclick="var g=document.getElementById('${id}_fmtg');g.querySelectorAll('.active').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('${id}_fmtlbl').textContent='${f.label}'" style="font-size:.65rem">${f.label}</button>`).join('')}
      </div>
      <p style="font-size:.75rem;color:var(--text-dim);margin-bottom:6px">Persona: <span id="${id}_perlbl">${PERSONA_OPTS[curPer]}</span></p>
      <div id="${id}_perg" style="display:flex;flex-wrap:wrap;gap:4px">
        ${perOpts.map(p => `<button class="feed-chip ${curPer===p.value?'active':''}" onclick="var g=document.getElementById('${id}_perg');g.querySelectorAll('.active').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('${id}_perlbl').textContent='${p.label}'" style="font-size:.65rem">${p.label}</button>`).join('')}
      </div>`;
    return showDialog('Ustawienia artykułu', html,
      [{ label:'Użyj globalnych', style:'secondary', value:'default' },{ label:'Generuj z tymi', style:'primary', value:'ok'}]
    ).then(val => {
      if (val !== 'ok') return null;
      const fmtActive = document.querySelector('#' + id + '_fmtg .active');
      const perActive = document.querySelector('#' + id + '_perg .active');
      return { format: fmtActive?.textContent ? Object.entries(FORMAT_OPTS).find(([k,v])=>v===fmtActive.textContent)?.[0] || curFmt : curFmt, persona: perActive?.textContent ? Object.entries(PERSONA_OPTS).find(([k,v])=>v===perActive.textContent)?.[0] || curPer : curPer };
    });
  }

  // ===========================
  // Settings API
  // ===========================
  async function loadSettings() {
    try { const r = await fetch('/api/settings'); settingsCache = await r.json(); }
    catch { settingsCache = {}; }
    return settingsCache;
  }
  async function saveSettings(data) {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      settingsCache = data;
      updateHeaderInfo();
    } catch { showToast('Błąd zapisu ustawień', 'err'); }
  }

  function updateHeaderInfo() {
    const s = settingsCache || {};
    const parts = [];
    if (s.format && s.format !== 'article') parts.push(`<span>format</span> <strong>${s.format}</strong>`);
    if (s.persona && s.persona !== 'journalist') parts.push(`<span>persona</span> <strong>${s.persona}</strong>`);
    if (s.tone && s.tone !== 'casual') parts.push(`<span>ton</span> <strong>${s.tone}</strong>`);
    if (s.lang && s.lang !== 'pl') parts.push(`<span>język</span> <strong>${s.lang.toUpperCase()}</strong>`);
    if (parts.length) {
      headerInfo.innerHTML = parts.join('<span style="opacity:.25;margin:0 4px">|</span>');
      headerInfo.classList.add('show');
    } else {
      headerInfo.classList.remove('show');
    }
  }

  // ===========================
  // Status
  // ===========================
  async function updateNbStatus() {
    const prev = nbAuthed;
    try {
      const resp = await fetch('/api/nb/auth-status');
      const data = await resp.json();
      nbAuthed = !!data.auth;
    } catch { nbAuthed = false; }
    updateNbStatusUI();
    if (prev !== nbAuthed && currentLevel().level === 'home') render();
  }
  function updateNbStatusUI() {
    if (!headerNbStatus) return;
    const dot = headerNbStatus.querySelector('.status-dot');
    const label = headerNbStatus.querySelector('.status-label');
    if (nbAuthed) {
      if (dot) dot.className = 'status-dot on';
      if (label) label.textContent = 'NB: Online';
    } else {
      if (dot) dot.className = 'status-dot off';
      if (label) label.textContent = 'NB: Offline';
    }
  }
  async function updateStatus() {
    try {
      const resp = await fetch('/api/status');
      const data = await resp.json();
      const dot = headerStatus.querySelector('.status-dot');
      const label = headerStatus.querySelector('.status-label');
      if (data.configured && data.models.length > 0) {
        dot.className = 'status-dot on';
        label.textContent = 'Online';
        headerModel.textContent = data.models[0] || '—';
      } else if (data.configured) {
        dot.className = 'status-dot on';
        label.textContent = 'Online';
        headerModel.textContent = data.model || '—';
      } else {
        dot.className = 'status-dot off';
        label.textContent = 'NVIDIA offline';
        headerModel.textContent = '—';
      }
    } catch {
      headerStatus.querySelector('.status-dot').className = 'status-dot off';
      headerStatus.querySelector('.status-label').textContent = 'Offline';
    }
  }

  async function loadModels() {
    try {
      const r = await fetch('/api/models');
      modelsList = await r.json();
    } catch { modelsList = []; }
  }

  // ===========================
  // Custom cursor
  // ===========================
  let mx = -100, my = -100, cx = -100, cy = -100;
  function initCursor() {
    if (!matchMedia('(hover:hover)and(pointer:fine)').matches) return;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; cursorDot.style.left = mx+'px'; cursorDot.style.top = my+'px'; });
    function lerp() {
      cx += (mx - cx) * 0.1;
      cy += (my - cy) * 0.1;
      cursorRing.style.left = cx+'px';
      cursorRing.style.top = cy+'px';
      requestAnimationFrame(lerp);
    }
    cx = mx; cy = my;
    requestAnimationFrame(lerp);
    document.addEventListener('mouseover', e => {
      if (e.target.closest('.tile, .dialog-btn, .result-btn, .result-link')) cursorRing.classList.add('hover');
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('.tile, .dialog-btn, .result-btn, .result-link')) cursorRing.classList.remove('hover');
    });
    document.addEventListener('mousedown', () => cursorDot.classList.add('click'));
    document.addEventListener('mouseup', () => cursorDot.classList.remove('click'));
  }

  // ===========================
  // Preloader
  // ===========================
  function initPreloader() {
    const fill = preloader.querySelector('.preloader-fill');
    fill.style.width = '100%';
    setTimeout(() => {
      preloader.classList.add('reveal');
    }, 600);
  }

  // ===========================
  // Sidebar job queue
  // ===========================
  function addJobToQueue(label, status, output) {
    jobHistory.unshift({ label, status, time: new Date(), output: output || '' });
    if (jobHistory.length > 20) jobHistory.length = 20;
    renderJobQueue();
  }
  function renderJobQueue() {
    const el = document.getElementById('jobQueue');
    if (!el) return;
    const items = [];
    if (running) items.push({ label: running.tileAction?.label || 'Zadanie', status: 'running', output: running.output, _isRunning: true });
    jobHistory.forEach(j => {
      if (!running || j.label !== (running.tileAction?.label || 'Zadanie')) items.push(j);
    });
    if (items.length === 0) { el.innerHTML = '<div class="job-empty">Brak aktywnych zadań</div>'; return; }
    el.innerHTML = items.slice(0, 12).map((j, i) => {
      const cls = j.status === 'running' ? 'running' : j.status === 'error' ? 'error' : 'done';
      const icon = j.status === 'running' ? '🔄' : j.status === 'error' ? '❌' : '✅';
      const time = j.time ? new Date(j.time).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="job-item ${cls}" data-job-idx="${i}" title="Kliknij aby zobaczyć szczegóły">
        <span class="job-label">${icon} ${j.label}</span>
        <span class="job-status">${time}</span>
      </div>`;
    }).join('');
    el.querySelectorAll('.job-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.jobIdx);
        if (isNaN(idx)) return;
        const job = items[idx];
        if (!job) return;
        if (job._isRunning && running) {
          if (currentLevel().level !== 'progress') pushLevel({ level: 'progress', data: { action: running.tileAction?.action, label: running.tileAction?.label } });
          return;
        }
        if (job.output) {
          const clean = (job.output || '').replace(/\x1b\[[0-9;]*m/g, '');
          const preview = clean.split('\n').filter(l => l.trim()).slice(-12).join('\n').substring(0, 600);
          showDialog('Szczegóły zadania', `<p style="color:var(--text-dim);margin-bottom:8px;font-size:.75rem">${escapeHtml(job.label)} · ${job.status}</p><pre style="font-family:var(--font-mono);font-size:.7rem;color:var(--text-dim);max-height:300px;overflow-y:auto;white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:4px">${escapeHtml(preview)}</pre>`, [{ label:'Zamknij', style:'secondary', value: null }]).then(() => {});
        } else {
          showToast('Brak danych dla tego zadania', '');
        }
      });
    });
  }
  function updateSidebarStats() {
    const aEl = document.getElementById('sidebarArticles');
    const mEl = document.getElementById('sidebarModel');
    const tEl = document.getElementById('sidebarTopicQueue');
    if (aEl && telemetryCache) aEl.textContent = `${telemetryCache.articles?.total || 0} artykułów`;
    if (mEl) mEl.textContent = (settingsCache.model || '—');
    if (tEl) {
      fetch('/api/topics').then(r => r.json()).then(d => {
        const pending = (d.topics || []).filter(t => t.status === 'pending').length;
        tEl.textContent = `${(d.topics || []).length} tematów (${pending} do zrobienia)`;
      }).catch(() => {});
    }
  }

  // Sidebar action clicks
  document.querySelectorAll('.sidebar-action').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      if (action === 'home' && !running) { navStack = [{ level: 'home' }]; render(); }
      if (action === 'articles' && !running) pushLevel({ level: 'articles' });
    });
  });
  // Sidebar stat click for articles
  const articlesStat = document.getElementById('sidebarArticles');
  if (articlesStat) {
    articlesStat.addEventListener('click', () => { if (!running) pushLevel({ level: 'articles' }); });
  }
  const topicStat = document.getElementById('sidebarTopicQueue');
  if (topicStat) {
    topicStat.addEventListener('click', () => { if (!running) pushLevel({ level: 'topic-queue' }); });
  }
  async function init() {
    initPreloader();
    initCursor();
    await Promise.all([loadSettings(), loadModels()]);
    updateStatus(); updateNbStatus(); updateSidebarStats();
    setInterval(updateStatus, 15000);
    setInterval(updateNbStatus, 45000);
    updateHeaderInfo();
    const warmupBtn = document.querySelector('.sidebar-action[data-action="warmup"]');
    if (warmupBtn) warmupBtn.addEventListener('click', () => handleWarmup(warmupBtn));
    render();
  }

  init();
})();
