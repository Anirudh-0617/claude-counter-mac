(() => {
  'use strict';

  const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
  const TAG = 'ClaudeCounter';

  function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  class BridgeClient {
    constructor() {
      this._pending   = new Map();
      this._listeners = new Map();

      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.cc !== TAG) return;

        if (msg.type === 'cc:response') {
          const p = this._pending.get(msg.requestId);
          if (!p) return;
          this._pending.delete(msg.requestId);
          clearTimeout(p.timeoutId);
          msg.ok ? p.resolve(msg.payload) : p.reject(new Error(msg.error || 'Bridge error'));
          return;
        }

        this._emit(msg.type, msg.payload);
      });
    }

    _emit(type, payload) {
      const fns = this._listeners.get(type);
      if (!fns) return;
      for (const fn of fns) fn(payload);
    }

    on(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
      return () => this._listeners.get(type)?.delete(fn);
    }

    request(kind, payload, { timeoutMs = 15000 } = {}) {
      const requestId = makeId();
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this._pending.delete(requestId);
          reject(new Error(`Bridge timeout: ${kind}`));
        }, timeoutMs);
        this._pending.set(requestId, { resolve, reject, timeoutId });
        window.postMessage({ cc: TAG, type: 'cc:request', requestId, kind, payload }, '*');
      });
    }

    requestUsage(orgId)                     { return this.request('usage',        { orgId },                         { timeoutMs: 15000 }); }
    requestConversation(orgId, conversationId) { return this.request('conversation', { orgId, conversationId },         { timeoutMs: 20000 }); }
    requestHash(text)                       { return this.request('hash',         { text },                          { timeoutMs:  5000 }); }
  }

  // ── Inject bridge.js into page context ───────────────────────────────────
  let _bridgeReady = null;

  function injectBridgeOnce() {
    if (_bridgeReady) return _bridgeReady;
    if (document.getElementById(CC.DOM.BRIDGE_SCRIPT_ID)) {
      _bridgeReady = Promise.resolve(true);
      return _bridgeReady;
    }
    const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
    if (!runtime) { _bridgeReady = Promise.resolve(false); return _bridgeReady; }

    _bridgeReady = new Promise((resolve) => {
      const s = document.createElement('script');
      s.id      = CC.DOM.BRIDGE_SCRIPT_ID;
      s.src     = runtime.getURL('src/injected/bridge.js');
      s.onload  = () => resolve(true);
      s.onerror = () => resolve(false);
      (document.head || document.documentElement).appendChild(s);
    });
    return _bridgeReady;
  }

  CC.bridge          = new BridgeClient();
  CC.injectBridgeOnce = injectBridgeOnce;
})();
