(() => {
  'use strict';

  const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isDark = () => document.documentElement.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  function formatMs(ms) {
    if (ms == null || ms < 0) return null;
    const s = Math.floor(ms / 1000);
    if (s < 60)  return `${s}s`;
    const m = Math.floor(s / 60), sec = s % 60;
    if (m < 60)  return `${m}:${String(sec).padStart(2, '0')}`;
    const h = Math.floor(m / 60), min = m % 60;
    return `${h}h ${min}m`;
  }

  function formatTokens(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function pct(n, d) {
    if (!d) return 0;
    return Math.min(100, Math.max(0, (n / d) * 100));
  }

  function detectModel() {
    const el = document.querySelector('[data-testid="model-selector-dropdown"]');
    const txt = (el?.textContent ?? '').toLowerCase();
    if (txt.includes('haiku'))  return 'haiku';
    if (txt.includes('opus'))   return 'opus';
    if (txt.includes('sonnet')) return 'sonnet';
    return 'default';
  }

  function estimateCost(inputTokens, outputTokens) {
    const model   = detectModel();
    const pricing = CC.PRICING[model] ?? CC.PRICING.default;
    const cost    = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
    if (cost < 0.0001) return '<$0.0001';
    return '$' + cost.toFixed(4);
  }

  // ── Progress bar helper ───────────────────────────────────────────────────
  function makeBar(pctValue, opts = {}) {
    const { warn = false, danger = false, mini = false } = opts;
    const bar = document.createElement('div');
    bar.className = 'cc-bar' + (mini ? ' cc-bar--mini' : ' cc-bar--usage');
    const fill = document.createElement('div');
    fill.className = 'cc-bar__fill' +
      (pctValue >= 100 ? ' cc-full' : '') +
      (danger ? ' cc-danger' : warn ? ' cc-warn' : '');
    fill.style.width = Math.min(100, pctValue) + '%';
    bar.appendChild(fill);
    return { bar, fill };
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  function attachTooltip(trigger, getContent) {
    let tip = null;
    function show(e) {
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'cc-tooltip';
        document.body.appendChild(tip);
      }
      tip.textContent = getContent();
      tip.style.opacity = '1';
      position(e);
    }
    function position(e) {
      if (!tip) return;
      const x = Math.min(e.clientX + 12, window.innerWidth  - tip.offsetWidth  - 8);
      const y = Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 8);
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    }
    function hide() {
      if (tip) tip.style.opacity = '0';
    }
    trigger.addEventListener('mouseenter', show);
    trigger.addEventListener('mousemove',  position);
    trigger.addEventListener('mouseleave', hide);
    return () => {
      trigger.removeEventListener('mouseenter', show);
      trigger.removeEventListener('mousemove',  position);
      trigger.removeEventListener('mouseleave', hide);
      tip?.remove();
    };
  }

  // ── CounterUI ─────────────────────────────────────────────────────────────
  class CounterUI {
    constructor({ onUsageRefresh } = {}) {
      this._onUsageRefresh = onUsageRefresh ?? (() => {});

      // Conversation state
      this._totalTokens  = null;
      this._inputTokens  = null;
      this._outputTokens = null;
      this._cachedUntil  = null;
      this._pendingCache = false;

      // Usage state
      this._usage = null;   // { five_hour, seven_day }

      // DOM refs
      this._headerEl  = null;
      this._usageEl   = null;
      this._panelEl   = null;
      this._panelOpen = false;

      // Cleanup
      this._cleanups = [];
    }

    initialize() {
      // Nothing to do on init; elements are attached lazily
    }

    // ── Attach the header pill into the chat title bar ─────────────────────
    attachHeader() {
      if (this._headerEl && document.contains(this._headerEl)) return;

      const trigger = document.querySelector(CC.DOM.CHAT_MENU_TRIGGER);
      if (!trigger) return;

      const existing = document.getElementById(CC.DOM.HEADER_ID);
      if (existing) existing.remove();

      const el = document.createElement('div');
      el.id = CC.DOM.HEADER_ID;
      el.className = 'cc-header';
      trigger.parentElement?.insertBefore(el, trigger.nextSibling);
      this._headerEl = el;
      this._renderHeader();
    }

    // ── Attach the usage row near the model selector ───────────────────────
    attachUsageLine() {
      if (this._usageEl && document.contains(this._usageEl)) return;

      const anchor = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
      if (!anchor) return;

      const existing = document.getElementById(CC.DOM.USAGE_ROW_ID);
      if (existing) existing.remove();

      const el = document.createElement('div');
      el.id = CC.DOM.USAGE_ROW_ID;
      el.className = 'cc-usage-row';
      anchor.parentElement?.insertBefore(el, anchor);
      this._usageEl = el;

      // Click to refresh
      el.addEventListener('click', () => this._onUsageRefresh());
      this._renderUsage();
    }

    // ── Data setters ───────────────────────────────────────────────────────
    setConversationMetrics(metrics) {
      if (!metrics) {
        this._totalTokens  = null;
        this._inputTokens  = null;
        this._outputTokens = null;
        this._cachedUntil  = null;
      } else {
        this._totalTokens  = metrics.totalTokens  ?? null;
        this._inputTokens  = metrics.inputTokens  ?? null;
        this._outputTokens = metrics.outputTokens ?? null;
        this._cachedUntil  = metrics.cachedUntil  ?? null;
      }
      this._pendingCache = false;
      this._renderHeader();
    }

    setPendingCache(v) {
      this._pendingCache = v;
      this._renderHeader();
    }

    setUsage(usage) {
      this._usage = usage;
      this._renderUsage();
    }

    // ── 1-second tick (called by main.js) ──────────────────────────────────
    tick() {
      this._renderHeader();
      this._renderUsage();
    }

    // ── Header rendering ───────────────────────────────────────────────────
    _renderHeader() {
      const el = this._headerEl;
      if (!el || !document.contains(el)) return;

      const total = this._totalTokens;
      const limit = CC.CONST.CONTEXT_LIMIT_TOKENS;

      // Token count text
      let tokenText = total != null ? `~${formatTokens(total)} tokens` : '';
      if (this._pendingCache && total == null) tokenText = '…';

      // Cache countdown
      let cacheText = '';
      if (this._cachedUntil) {
        const remaining = this._cachedUntil - Date.now();
        if (remaining > 0) {
          cacheText = `cached ${formatMs(remaining)}`;
        }
      } else if (this._pendingCache) {
        cacheText = 'caching…';
      }

      // Progress pct
      const p     = total != null ? pct(total, limit) : 0;
      const isWarn   = p >= CC.CONST.WARN_THRESHOLD   * 100;
      const isDanger = p >= CC.CONST.DANGER_THRESHOLD * 100;
      const color = isDanger ? 'var(--cc-red)' : isWarn ? 'var(--cc-orange)' : 'var(--cc-blue)';

      el.innerHTML = '';

      if (!tokenText) return;

      // Build pill
      const pill = document.createElement('div');
      pill.className = 'cc-pill';

      // SVG arc ring
      const R = 8, C = 10, stroke = 2;
      const circ = 2 * Math.PI * R;
      const dashOffset = circ * (1 - p / 100);
      const svg = `<svg class="cc-ring" width="20" height="20" viewBox="0 0 ${C*2} ${C*2}">
        <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--cc-track)" stroke-width="${stroke}"/>
        <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${C} ${C})"/>
      </svg>`;

      pill.innerHTML = svg;

      const textSpan = document.createElement('span');
      textSpan.className = 'cc-pill-text';
      textSpan.textContent = tokenText;
      pill.appendChild(textSpan);

      if (cacheText) {
        const sep = document.createElement('span');
        sep.className = 'cc-pill-sep';
        sep.textContent = '·';
        const cacheSpan = document.createElement('span');
        cacheSpan.className = 'cc-pill-cache';
        cacheSpan.textContent = cacheText;
        pill.appendChild(sep);
        pill.appendChild(cacheSpan);
      }

      el.appendChild(pill);

      // Tooltip: detailed info
      attachTooltip(pill, () => {
        const lines = [];
        if (total != null) {
          lines.push(`Tokens: ${total.toLocaleString()} / ${limit.toLocaleString()} (${p.toFixed(1)}%)`);
        }
        if (this._inputTokens  != null) lines.push(`  Input:  ${this._inputTokens.toLocaleString()}`);
        if (this._outputTokens != null) lines.push(`  Output: ${this._outputTokens.toLocaleString()}`);
        if (this._inputTokens != null && this._outputTokens != null) {
          const cost = estimateCost(this._inputTokens, this._outputTokens);
          lines.push(`Est. cost: ${cost}`);
        }
        if (this._cachedUntil) {
          const rem = this._cachedUntil - Date.now();
          if (rem > 0) lines.push(`Cache: ${formatMs(rem)} remaining`);
        }
        return lines.join('\n') || 'No data';
      });
    }

    // ── Usage row rendering ────────────────────────────────────────────────
    _renderUsage() {
      const el = this._usageEl;
      if (!el || !document.contains(el)) return;

      el.innerHTML = '';

      const usage = this._usage;
      if (!usage?.five_hour && !usage?.seven_day) {
        const placeholder = document.createElement('div');
        placeholder.className = 'cc-usage-placeholder';
        placeholder.textContent = 'Click to load usage…';
        el.appendChild(placeholder);
        return;
      }

      // Build two groups: session (5h) and weekly (7d)
      if (usage.five_hour) el.appendChild(this._makeUsageGroup(usage.five_hour, '5h', 'Session'));
      if (usage.five_hour && usage.seven_day) {
        const div = document.createElement('div');
        div.className = 'cc-usage-divider';
        el.appendChild(div);
      }
      if (usage.seven_day) el.appendChild(this._makeUsageGroup(usage.seven_day, '7d', 'Weekly'));
    }

    _makeUsageGroup(window, key, label) {
      const util   = window.utilization ?? 0;   // 0–100
      const isWarn   = util >= 75;
      const isDanger = util >= 90;
      const resetMs  = window.resets_at ? Date.parse(window.resets_at) - Date.now() : null;
      const resetStr = resetMs != null && resetMs > 0 ? formatMs(resetMs) : null;

      const group = document.createElement('div');
      group.className = 'cc-usage-group';

      // Label + pct
      const meta = document.createElement('div');
      meta.className = 'cc-usage-meta';

      const lbl = document.createElement('span');
      lbl.className = 'cc-usage-label';
      lbl.textContent = label;

      const pctSpan = document.createElement('span');
      pctSpan.className = 'cc-usage-pct' + (isDanger ? ' cc-danger' : isWarn ? ' cc-warn' : '');
      pctSpan.textContent = util.toFixed(1) + '%';

      meta.appendChild(lbl);
      meta.appendChild(pctSpan);
      group.appendChild(meta);

      // Bar
      const { bar } = makeBar(util, { warn: isWarn, danger: isDanger });
      group.appendChild(bar);

      // Reset timer
      if (resetStr) {
        const reset = document.createElement('div');
        reset.className = 'cc-usage-reset';
        reset.textContent = `resets in ${resetStr}`;
        group.appendChild(reset);
      }

      // Tooltip
      attachTooltip(group, () => {
        const lines = [`${label} usage: ${util.toFixed(2)}%`];
        if (resetStr) lines.push(`Resets in: ${resetStr}`);
        lines.push('Click row to refresh');
        return lines.join('\n');
      });

      return group;
    }
  }

  CC.ui = { CounterUI };
})();
