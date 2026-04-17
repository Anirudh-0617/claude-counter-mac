(() => {
  'use strict';

  const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

  if (CC.__started) return;
  CC.__started = true;

  // ── Utilities ─────────────────────────────────────────────────────────────
  function getConversationId() {
    const m = window.location.pathname.match(/\/chat\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function getOrgIdFromCookie() {
    try {
      return document.cookie.split('; ')
        .find(r => r.startsWith('lastActiveOrg='))
        ?.split('=')[1] || null;
    } catch { return null; }
  }

  function waitForElement(selector, timeoutMs = 30000) {
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let tid;
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { clearTimeout(tid); obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      tid = setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let currentConvId = null;
  let currentOrgId  = null;
  let usageState    = null;
  let usageResetMs  = { five_hour: null, seven_day: null };
  let lastUsageMs   = 0;
  let lastSseMs     = 0;
  let fetchInFlight = false;
  const rolloverDone = { five_hour: null, seven_day: null };

  // ── UI ────────────────────────────────────────────────────────────────────
  const ui = new CC.ui.CounterUI({
    onUsageRefresh: () => refreshUsage(),
  });
  ui.initialize();

  // ── Bridge ────────────────────────────────────────────────────────────────
  const bridgeReady = CC.injectBridgeOnce();

  // ── Usage parsing ─────────────────────────────────────────────────────────
  function normalizeUsageWindow(w, hours) {
    if (!w || typeof w !== 'object') return null;
    if (typeof w.utilization !== 'number' || !isFinite(w.utilization)) return null;
    return {
      utilization:  Math.max(0, Math.min(100, w.utilization)),
      resets_at:    typeof w.resets_at === 'string' ? w.resets_at : null,
      window_hours: hours,
    };
  }

  function parseUsageEndpoint(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const fh = normalizeUsageWindow(raw.five_hour, 5);
    const sd = normalizeUsageWindow(raw.seven_day,  24 * 7);
    if (!fh && !sd) return null;
    return { five_hour: fh, seven_day: sd };
  }

  function parseUsageSse(raw) {
    if (!raw?.windows || typeof raw.windows !== 'object') return null;
    const norm = (w, hours) => {
      if (!w || typeof w !== 'object') return null;
      if (typeof w.utilization !== 'number' || !isFinite(w.utilization)) return null;
      const resets_at = typeof w.resets_at === 'number' && isFinite(w.resets_at)
        ? new Date(w.resets_at * 1000).toISOString()
        : null;
      return { utilization: Math.max(0, Math.min(100, w.utilization * 100)), resets_at, window_hours: hours };
    };
    const fh = norm(raw.windows['5h'], 5);
    const sd = norm(raw.windows['7d'], 24 * 7);
    if (!fh && !sd) return null;
    return { five_hour: fh, seven_day: sd };
  }

  function applyUsage(normalized, source) {
    if (!normalized) return;
    const now = Date.now();
    usageState = normalized;
    lastUsageMs = now;
    if (source === 'sse') lastSseMs = now;
    usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
    usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
    ui.setUsage(normalized);
  }

  function updateOrgId(id) {
    if (id && typeof id === 'string' && id !== currentOrgId) currentOrgId = id;
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  async function refreshUsage() {
    await bridgeReady;
    const orgId = currentOrgId || getOrgIdFromCookie();
    if (!orgId) return;
    updateOrgId(orgId);
    if (fetchInFlight) return;
    fetchInFlight = true;
    try {
      const raw    = await CC.bridge.requestUsage(orgId);
      const parsed = parseUsageEndpoint(raw);
      applyUsage(parsed, 'usage');
    } catch { /* silent */ } finally {
      fetchInFlight = false;
    }
  }

  async function refreshConversation() {
    await bridgeReady;
    if (!currentConvId) { ui.setConversationMetrics(null); return; }
    const orgId = currentOrgId || getOrgIdFromCookie();
    if (!orgId) return;
    updateOrgId(orgId);
    try {
      await CC.bridge.requestConversation(orgId, currentConvId);
    } catch { /* silent */ }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────────
  CC.bridge.on('cc:generation_start', () => {
    if (!currentConvId) return;
    ui.setPendingCache(true);
  });

  CC.bridge.on('cc:conversation', async ({ orgId, conversationId, data }) => {
    if (!conversationId || conversationId !== currentConvId) return;
    updateOrgId(orgId);
    if (!data) return;
    const metrics = await CC.tokens.computeConversationMetrics(data);
    ui.setConversationMetrics(metrics);
  });

  CC.bridge.on('cc:message_limit', (raw) => {
    const parsed = parseUsageSse(raw);
    applyUsage(parsed, 'sse');
  });

  // ── URL change handler ────────────────────────────────────────────────────
  async function handleUrlChange() {
    currentConvId = getConversationId();

    // Attach usage line (exists even on home page)
    waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN).then(el => { if (el) ui.attachUsageLine(); });

    // Attach header (only in chat views)
    waitForElement(CC.DOM.CHAT_MENU_TRIGGER).then(el => { if (el) ui.attachHeader(); });

    if (!currentConvId) {
      ui.setConversationMetrics(null);
      return;
    }

    updateOrgId(getOrgIdFromCookie());
    await refreshConversation();
    if (!usageState) await refreshUsage();
  }

  function observeUrlChanges(callback) {
    let last = window.location.pathname;
    const check = () => {
      const cur = window.location.pathname;
      if (cur !== last) { last = cur; callback(); }
    };
    window.addEventListener('cc:urlchange', check);
    window.addEventListener('popstate',     check);
    return () => {
      window.removeEventListener('cc:urlchange', check);
      window.removeEventListener('popstate',     check);
    };
  }

  observeUrlChanges(handleUrlChange);

  // ── Branch navigation (prev/next message branch) ──────────────────────────
  let branchObs = null;
  document.addEventListener('click', (e) => {
    if (!currentConvId) return;
    const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
    if (!btn) return;
    const container = btn.closest('.inline-flex');
    const indicator = Array.from(container?.querySelectorAll('span') ?? [])
      .find(s => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
    if (!indicator) return;
    const orig = indicator.textContent;
    branchObs?.disconnect();
    branchObs = new MutationObserver(() => {
      if (indicator.textContent !== orig) {
        branchObs.disconnect();
        branchObs = null;
        refreshConversation();
      }
    });
    branchObs.observe(indicator, { childList: true, characterData: true, subtree: true });
    setTimeout(() => { branchObs?.disconnect(); branchObs = null; }, 60000);
  });

  // ── 1-second tick ─────────────────────────────────────────────────────────
  setInterval(() => {
    ui.tick();

    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    // Auto-refresh when a usage window rolls over
    for (const key of ['five_hour', 'seven_day']) {
      const resetAt = usageResetMs[key];
      if (resetAt && now >= resetAt && rolloverDone[key] !== resetAt) {
        rolloverDone[key] = resetAt;
        refreshUsage();
      }
    }

    // Hourly safety refresh if SSE is stale
    if (!document.hidden && (now - lastSseMs) > ONE_HOUR && (now - lastUsageMs) > ONE_HOUR) {
      refreshUsage();
    }
  }, 1000);

  // ── Boot ──────────────────────────────────────────────────────────────────
  handleUrlChange();
})();
