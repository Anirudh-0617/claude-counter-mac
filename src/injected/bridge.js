(() => {
  'use strict';

  // ── Prevent double-injection ──────────────────────────────────────────────
  if (window.__ccBridgeActive) return;
  window.__ccBridgeActive = true;

  const TAG = 'ClaudeCounter';

  // ── postMessage helpers ───────────────────────────────────────────────────
  function emit(type, payload) {
    window.postMessage({ cc: TAG, type, payload }, '*');
  }

  function respond(requestId, ok, payload, error) {
    window.postMessage({ cc: TAG, type: 'cc:response', requestId, ok, payload: payload ?? null, error: error ?? null }, '*');
  }

  // ── URL-change shim (SPA navigation detection) ───────────────────────────
  ['pushState', 'replaceState'].forEach((method) => {
    const orig = history[method].bind(history);
    history[method] = function (...args) {
      const result = orig(...args);
      window.dispatchEvent(new Event('cc:urlchange'));
      return result;
    };
  });

  // ── SSE parser — finds message_limit events in generation streams ─────────
  const SSE_FIELD_RE = /^(data|event):\s*(.*)/;

  function parseSseChunk(text) {
    const events = [];
    let current = {};
    for (const line of text.split('\n')) {
      const m = SSE_FIELD_RE.exec(line);
      if (m) {
        current[m[1]] = m[2];
      } else if (line === '' && current.data) {
        events.push({ ...current });
        current = {};
      }
    }
    return events;
  }

  function handleSseEvent(ev) {
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { return; }

    if (parsed?.type === 'message_limit') {
      emit('cc:message_limit', parsed.message_limit ?? parsed);
    }
  }

  // ── Fetch interceptor ─────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const isCompletion = /\/completion$/.test(url);
    const isConversation = /\/chat_conversations\/[^/?]+(\?|$)/.test(url);

    const response = await _fetch(input, init);

    // ── Generation stream: intercept SSE for message_limit ──────────────────
    if (isCompletion && response.ok && response.body) {
      emit('cc:generation_start', null);

      const [streamA, streamB] = response.body.tee();
      const decoder = new TextDecoder();
      let buffer = '';

      (async () => {
        const reader = streamA.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Process complete SSE blocks (separated by double newline)
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
              for (const ev of parseSseChunk(block + '\n\n')) {
                handleSseEvent(ev);
              }
            }
          }
          // Flush any remaining
          if (buffer.trim()) {
            for (const ev of parseSseChunk(buffer)) handleSseEvent(ev);
          }
        } catch { /* stream read errors are non-critical */ }
      })();

      return new Response(streamB, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  };

  // ── Handle requests from content script ──────────────────────────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.cc !== TAG || msg.type !== 'cc:request') return;

    const { requestId, kind, payload } = msg;

    try {
      if (kind === 'usage') {
        const { orgId } = payload;
        const r = await _fetch(`/api/organizations/${orgId}/usage`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        respond(requestId, true, await r.json());

      } else if (kind === 'conversation') {
        const { orgId, conversationId } = payload;
        const params = new URLSearchParams({
          rendering_mode: 'messages',
          render_all_tools: 'true',
        });
        const r = await _fetch(
          `/api/organizations/${orgId}/chat_conversations/${conversationId}?${params}`,
          { credentials: 'include' }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        respond(requestId, true, { orgId, conversationId, data });

      } else if (kind === 'hash') {
        const { text } = payload;
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        respond(requestId, true, { hash });

      } else {
        respond(requestId, false, null, `Unknown kind: ${kind}`);
      }
    } catch (err) {
      respond(requestId, false, null, String(err?.message ?? err));
    }
  });
})();
