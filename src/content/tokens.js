(() => {
  'use strict';

  const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

  const ROOT_MSG_ID = '00000000-0000-4000-8000-000000000000';

  // ── Token estimation ───────────────────────────────────────────────────────
  // Approximation: 1 token ≈ 4 chars for English. We apply a small word-
  // boundary heuristic for slightly better accuracy without a full tokenizer.
  function countTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    let tokens = 0;
    // Split on whitespace runs; each word contributes ceil(len/4) tokens
    // Common short words (1-3 chars) count as 1 token each.
    const words = text.split(/\s+/);
    for (const w of words) {
      if (!w) continue;
      tokens += Math.max(1, Math.ceil(w.length / 4));
    }
    // Add small overhead for punctuation/whitespace tokens (~5%)
    return Math.ceil(tokens * 1.05);
  }

  // ── Stable JSON stringify (for hashing tool payloads) ─────────────────────
  function stableStringify(val) {
    if (val === null || typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) return '[' + val.map(stableStringify).join(',') + ']';
    const keys = Object.keys(val).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(val[k])).join(',') + '}';
  }

  // ── Build the active conversation trunk (leaf → root, then reversed) ───────
  function buildTrunk(conversation) {
    const msgs  = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
    const byId  = new Map(msgs.filter(m => m?.uuid).map(m => [m.uuid, m]));
    const leaf  = conversation?.current_leaf_message_uuid;
    if (!leaf) return [];
    const trunk = [];
    let cur = leaf;
    while (cur && cur !== ROOT_MSG_ID) {
      const msg = byId.get(cur);
      if (!msg) break;
      trunk.push(msg);
      cur = msg.parent_message_uuid;
    }
    trunk.reverse();
    return trunk;
  }

  // ── Extract countable text from a message ─────────────────────────────────
  function extractText(message) {
    const parts = [];
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const t = item.type;
      // Skip thinking / images / docs (not in context in same way)
      if (t === 'thinking' || t === 'redacted_thinking' || t === 'image' || t === 'document') continue;
      if (t === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (t === 'tool_use') {
        parts.push(stableStringify({ id: item.id, name: item.name, input: item.input }));
      } else if (t === 'tool_result') {
        parts.push(stableStringify({ tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content }));
      } else if (typeof item.text === 'string') {
        parts.push(item.text);
      }
    }
    // Attachments extracted text
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    for (const a of attachments) {
      if (typeof a?.extracted_content === 'string') parts.push(a.extracted_content);
    }
    return parts.join('\n');
  }

  // ── Simple fingerprint cache (avoids re-tokenizing unchanged messages) ─────
  class TokenCache {
    constructor() { this._map = new Map(); }

    async get(uuid, text) {
      const fp = `${text.length}`;  // length as cheap fingerprint
      const cached = this._map.get(uuid);
      if (cached?.fp === fp) return cached.tokens;
      const tokens = countTokens(text);
      this._map.set(uuid, { fp, tokens });
      return tokens;
    }

    prune(keepIds) {
      const keep = new Set(keepIds);
      for (const id of this._map.keys()) {
        if (!keep.has(id)) this._map.delete(id);
      }
    }
  }

  const cache = new TokenCache();

  // ── Main: compute metrics for a full conversation ─────────────────────────
  async function computeConversationMetrics(conversation) {
    const trunk   = buildTrunk(conversation);
    const ids     = trunk.map(m => m.uuid).filter(Boolean);
    cache.prune(ids);

    let totalTokens     = 0;
    let inputTokens     = 0;
    let outputTokens    = 0;
    let lastAssistantMs = null;

    for (const msg of trunk) {
      const text   = extractText(msg);
      const tokens = msg?.uuid ? await cache.get(msg.uuid, text) : countTokens(text);
      totalTokens += tokens;

      if (msg?.sender === 'human')     inputTokens  += tokens;
      if (msg?.sender === 'assistant') outputTokens += tokens;

      if (msg?.sender === 'assistant' && msg?.created_at) {
        const ms = Date.parse(msg.created_at);
        if (!lastAssistantMs || ms > lastAssistantMs) lastAssistantMs = ms;
      }
    }

    const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

    return { totalTokens, inputTokens, outputTokens, lastAssistantMs, cachedUntil, messageCount: trunk.length };
  }

  CC.tokens = { computeConversationMetrics, countTokens };
})();
