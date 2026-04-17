# Claude Counter — macOS Enhanced 🪙

A polished Chrome extension for macOS that adds **real-time token tracking**, a **cache countdown timer**, **session/weekly usage bars**, and **estimated API costs** directly inside the Claude.ai chat interface — no external servers, no tracking, fully local.

> Built as an enhanced macOS-native port of [claude-counter](https://github.com/she-llac/claude-counter) by she-llac.

---

## Preview

```
[🪙 ~14.2k tokens · cached 4:23]          ← Header pill in chat title bar

Session  ████████░░░░░░  42.1%  resets in 2h 18m
Weekly   ██████████████  78.5%  resets in 1d 21h  ← Usage bars above input
```

---

## Features

### 🔢 Token Counter
- Shows approximate token count for the current conversation branch
- Circular arc progress ring — fills as you approach the 200k context limit
- Color coded: **blue** (normal) → **orange** (>75%) → **red** (>90%)
- Updates automatically after every message

### ⏱️ Cache Timer
- Displays a live countdown for how long Claude's prompt cache is active (5-minute window)
- Shows "caching…" while a generation is in progress
- Accurate to the second

### 📊 Session & Weekly Usage Bars
- Mirrors the native Claude usage page — but more accurate and always visible
- **Session bar** — 5-hour rolling usage window with reset countdown
- **Weekly bar** — 7-day rolling usage window with reset countdown
- Auto-refreshes when a window rolls over; hourly safety refresh
- Click the usage row to force an immediate refresh

### 💰 Cost Estimator (new vs original)
- Hover the token pill to see an estimated API cost for the current conversation
- Auto-detects the active model: **Haiku**, **Sonnet**, or **Opus**
- Uses Anthropic's current public pricing per 1M tokens:
  | Model | Input | Output |
  |-------|-------|--------|
  | Haiku 4.5 | $0.80 | $4.00 |
  | Sonnet 4.6 | $3.00 | $15.00 |
  | Opus 4.6 | $15.00 | $75.00 |

### 🎨 macOS-Native Design (new vs original)
- `backdrop-filter` blur pill — matches macOS system UI aesthetics
- SF Pro system font via `-apple-system`
- Smooth cubic-bezier animated progress bars
- Full dark mode support via CSS variables
- Tooltip with input/output token breakdown on hover

---

## Installation

### Option 1 — Load Unpacked (Developer Mode)

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `claude-counter-mac` folder
6. Open [claude.ai](https://claude.ai) — the counter appears automatically

### Option 2 — From ZIP

1. Download the latest ZIP from [Releases](../../releases)
2. Unzip it
3. Follow steps 2–6 above

> **Note:** Chrome may show a warning on startup about "developer mode extensions" — this is normal for unpacked extensions. You can dismiss it.

---

## How It Works

The extension uses a two-layer architecture to stay within Chrome's security model:

**Bridge script** (`src/injected/bridge.js`) — injected into the page context so it can intercept `fetch` calls. It:
- Wraps `window.fetch` to tap into Claude's generation SSE streams and extract `message_limit` events (session/weekly usage)
- Handles requests from the content script to fetch conversation data and org usage via Claude's internal API (using your existing session cookies — no credentials stored)
- Patches `history.pushState/replaceState` to detect SPA navigation

**Content scripts** — run in extension context and:
- Listen for messages from the bridge via `window.postMessage`
- Compute token estimates from conversation message trees
- Render and update the UI elements injected into Claude's DOM

**Token counting** uses a word-boundary heuristic (~1 token per 4 characters, adjusted per word length) — the same approximation Claude's own UI uses. Counts are prefixed with `~` to reflect this.

**Privacy** — all processing is local. The extension only reads your `lastActiveOrg` cookie and makes requests to `claude.ai`. No data ever leaves your browser.

---

## File Structure

```
claude-counter-mac/
├── manifest.json                  # Chrome MV3 manifest
├── README.md
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── styles.css                 # macOS-styled CSS with variables
    ├── content/
    │   ├── constants.js           # DOM selectors, limits, pricing
    │   ├── bridge-client.js       # postMessage bridge + bridge injector
    │   ├── tokens.js              # Token estimation & conversation tree walker
    │   ├── ui.js                  # UI rendering (pill, bars, tooltips)
    │   └── main.js                # Orchestration, URL tracking, tick loop
    └── injected/
        └── bridge.js              # Page-context fetch interceptor
```

---

## Differences from the Original

| Feature | Original (Windows) | This Build (macOS) |
|---|---|---|
| Platform | Windows/Linux Chrome | macOS Chrome |
| Tokenizer | Full o200k_base BPE | Word-boundary heuristic |
| Cost estimate | ❌ | ✅ Per-model, on hover |
| Input/output split | ❌ | ✅ Shown in tooltip |
| Design | Functional | macOS blur/vibrancy |
| Font | System default | SF Pro (`-apple-system`) |
| Progress bars | Box border style | Smooth pill shape |
| CSS architecture | Inline variables | Full CSS variable system |

---

## Permissions

The extension requests no special permissions beyond accessing `claude.ai`. It uses:
- `content_scripts` matching `https://claude.ai/*`
- `web_accessible_resources` to inject the bridge script into the page

---

## Credits

- Original extension: [claude-counter](https://github.com/she-llac/claude-counter) by **she-llac** — MIT License
- Token counting inspired by [gpt-tokenizer](https://github.com/nicolo-ribaudo/gpt-tokenizer)
- macOS enhancements, cost estimation, and redesign by **Anirudh Annaboina**

---

## License

MIT — see [LICENSE](LICENSE) for details.
