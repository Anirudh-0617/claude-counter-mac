(() => {
  'use strict';

  const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

  CC.DOM = Object.freeze({
    CHAT_MENU_TRIGGER:      '[data-testid="chat-menu-trigger"]',
    MODEL_SELECTOR_DROPDOWN:'[data-testid="model-selector-dropdown"]',
    BRIDGE_SCRIPT_ID:       'cc-bridge-script',
    HEADER_ID:              'cc-header',
    USAGE_ROW_ID:           'cc-usage-row',
    PANEL_ID:               'cc-panel',
  });

  CC.CONST = Object.freeze({
    CACHE_WINDOW_MS:       5 * 60 * 1000,   // 5 minutes
    CONTEXT_LIMIT_TOKENS:  200_000,
    WARN_THRESHOLD:        0.75,             // orange above 75%
    DANGER_THRESHOLD:      0.90,             // red above 90%
  });

  // Per-model pricing in USD per 1M tokens (Anthropic public pricing)
  CC.PRICING = Object.freeze({
    'haiku':   { input: 0.80,  output: 4.00  },
    'sonnet':  { input: 3.00,  output: 15.00 },
    'opus':    { input: 15.00, output: 75.00 },
    'default': { input: 3.00,  output: 15.00 },
  });
})();
