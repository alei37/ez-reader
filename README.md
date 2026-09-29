# EzReader

**English** (this file) · **中文** → [README.zh-CN.md](README.zh-CN.md)

Read local ebooks in Obsidian — progress tracking, highlights, research notes, optional online translation.

![Personal shelf](docs/screenshots/shelf.webp)

## Quick Start

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/alei37/ez-reader/releases/latest) into `<Vault>/.obsidian/plugins/ez-reader/`.
2. Settings → Community plugins → enable **EzReader**.
3. Click the 📚 ribbon icon (or run "EzReader: Open Shelf"). Pick a few EPUB / PDF / TXT / MOBI files and add them.
4. Click any cover to read. Select text → a menu pops up after 180 ms with **Thought / Excerpt / Translate / Copy**. Press `?` inside the reader for the full shortcut list.

## Features

**Multi-format reading** — EPUB (foliate-js), PDF (Obsidian's built-in viewer with a custom overlay for highlights + selection menu), TXT (paragraph-aware pagination), MOBI / AZW3 (per-chapter pages via `@lingo-reader/mobi-parser`).

**Goodreads-style shelf** — grid / list views, sortable, filterable (status / language / format / progress / recently opened), pinnable, cover cache. Click a status pill to cycle `Not started → Reading → Finished → Abandoned`.

**WeRead / Apple Books feel** — appearance modal (font 60–200 %, line height, margin, theme system/light/dark/sepia, paginated/scrolled), immersive mode on tablet, page-turn animation, touch-swipe, floating selection menu with shortcut labels printed under each button.

**Markdown-native annotations** — bookmarks, excerpts, and thoughts are saved as `.md` files inside your Vault. Excerpts get Obsidian block IDs (`^ex-uuid`) so any note can backlink with `[[book-note#^<excerptId>]]`.

**Quick actions** — `H` saves an excerpt with no modal, `B` adds a bookmark with auto-label `Chapter · %`, `Shift+H` opens the modal flow for note + tags, `Shift+T` writes a free-form thought or translates (context decides).

**6 translation providers** — Youdao / DeepL / Google Cloud / MyMemory (free, no key) / OpenAI-compatible (DeepSeek, Zhipu, Qwen, OpenAI) / Anthropic-compatible (e.g. MiniMax). Pick one and translate selection in EPUB / TXT / MOBI as a side drawer, or in PDF as a small draggable popover.

**Keyboard shortcuts** — full keyboard navigation everywhere. TOC panel: `↑↓` to move, `←/→` to expand/collapse, `Enter` to jump, with visited/current/unvisited progress dots persisted across sessions.

## Format-specific notes

### EPUB

Powered by [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1 (with a customElements patch). Two-page / scroll modes. Last position auto-restored.

### PDF

> **For the best PDF reading experience, install [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus).** It is a much more capable PDF reader (annotations, search, outline, page jump, etc.) than EzReader's thin overlay. **Heads-up:** PDF++ replaces Obsidian's built-in PDFView DOM, so EzReader's PDF overlay features below do **not** work alongside it — pick one or the other.

EzReader itself defers to Obsidian's built-in `pdf` view — standard `[[path.pdf]]` links work out of the box. A transparent overlay adds (only when no third-party PDF plugin is active):

- **Selection menu** with the same Thought / Excerpt / Translate / Copy actions as EPUB.
- **Translation popover** anchored to the selection, with **draggable** header (clamped to viewport). Has Copy + Change-target-language + × buttons.
- **Floating 📝 button** → bookmarks / excerpts list with one-click jump back. **The button itself is draggable** — its position is persisted per book via `localStorage`, so it stays where you put it across Obsidian restarts.
- **Highlight echo** — reopen a PDF and yellow highlight rectangles are drawn on each page by text-anchor matching.
- **Auto-attach on restart** — when Obsidian restores previously open PDF leaves, the overlay attaches automatically (no more "PDF translations don't work after restart").
- **PDF highlight click → notes** — clicking an existing PDF highlight opens the notes sidebar, jumps to that excerpt, and enters inline note edit mode.

### TXT / MOBI / AZW3

Three plain / chapter-text formats share `PagedTextSession` — same selection / highlight / theme UX as EPUB. TXT must be UTF-8 (no GBK auto-detection).

## Keyboard Shortcuts

| Action | Key | Action | Key |
|---|---|---|---|
| Previous page | `←` / `PageUp` | Toggle notes sidebar | `S` |
| Next page | `→` / `PageDown` | Toggle TOC | `T` |
| Quick highlight | `H` (bare) | Toggle immersive | `Shift+F` |
| Quick bookmark | `B` (bare) | Show help | `?` |
| Excerpt (modal) | `Shift+H` | Close panel | `Esc` |
| Translate / Thought | `Shift+T` | Copy selection | `C` |

`prev / next / translate / highlight / toggleSidebar / toggleToc` are remappable in Settings. Inside the TOC panel: `↑↓ Home End ←→ Enter Space Esc`.

## Translation

The only feature that touches the network, and only when you actively click the button. We send only the selected fragment, never the file or surrounding context. Configuration lives in your local `data.json`. The plugin uses Obsidian's `requestUrl` to bypass the renderer CSP.

| Provider | Free quota | Needs | Notes |
|---|---|---|---|
| **Youdao** | 100 chars / month | appKey + appSecret | Stable inside mainland China |
| **DeepL** | 500 K chars / month (`:fx` key) | API key | High quality |
| **Google Cloud Translation v3** | 500 K chars / month | service-account JSON | Card on file |
| **MyMemory** | 10 K chars / IP / day | **nothing** | Truly zero signup |
| **OpenAI-compatible** | your balance | baseUrl + key + model | DeepSeek / Zhipu / Qwen / OpenAI |
| **Anthropic-compatible** | your balance | baseUrl + key + model | e.g. MiniMax (`https://api.minimax.cn/anthropic`) |

Default target language is `zh-CN`. Switching providers wipes the old key (formats are not interchangeable).

## Installation

### From a GitHub release (recommended)

Download the three files from [Releases](https://github.com/alei37/ez-reader/releases) into `<Vault>/.obsidian/plugins/ez-reader/`. Open Obsidian → enable EzReader in Community plugins.

### From source

```bash
pnpm install --frozen-lockfile
pnpm run build   # produces main.js / styles.css / manifest.json
cp main.js styles.css manifest.json /path/to/<Vault>/.obsidian/plugins/ez-reader/
```

Requires Node.js ≥ 22.13 and pnpm ≥ 11.9.

## FAQ

<details>
<summary><strong>PDF opens but no notes sidebar / no selection menu?</strong></summary>

A third-party plugin (PDF++ etc.) is taking over Obsidian's PDFView and changing its DOM, so EzReader's overlay cannot attach. Check for `[ez-reader] handleProtocol: PdfOverlay not found` in the console. Reading still works — page jumps fall back to `setEphemeralState` / `openLinkText("#page=N")`. We recommend keeping PDF++ for the better PDF experience and accepting that EzReader's PDF overlay won't fire there; temporarily disable PDF++ to test the overlay.
</details>

<details>
<summary><strong>Opening a large MOBI freezes the UI for 2 – 5 s?</strong></summary>

`@lingo-reader/mobi-parser`'s `createParser` is a synchronous decompressor. Tracked as P1 polish — next version moves it to a Web Worker. Files under 5 MB are fine.
</details>

<details>
<summary><strong>TXT shows mojibake?</strong></summary>

EzReader only reads UTF-8. Re-encode GBK / GB18030 files as UTF-8 (VSCode / Notepad++) before importing. `decodeText` runs strict UTF-8 → GB18030 → permissive UTF-8 as a fallback for some GBK files.
</details>

<details>
<summary><strong>Translation says "API key not configured"?</strong></summary>

By design — we never silently send text to a default endpoint. Pick a provider in Settings → EzReader → Translation and fill the key. See [PRIVACY.md](PRIVACY.md).
</details>

<details>
<summary><strong>Progress doesn't sync to my Android tablet?</strong></summary>

Syncthing excludes `.obsidian/` by default — **including** `data.json`. Configure Syncthing to also sync `<Vault>/.obsidian/plugins/ez-reader/data.json`. Notes live in `notesDirectory` (a Vault-root folder by default) so they sync automatically.
</details>

<details>
<summary><strong>Will upgrading wipe my data?</strong></summary>

No. Upgrading only swaps `main.js` + `manifest.json` + `styles.css`. All state lives in `data.json` with optional schema fields and safe fallbacks.
</details>

<details>
<summary><strong>How do I uninstall?</strong></summary>

Delete `<Vault>/.obsidian/plugins/ez-reader/`. To preserve data, back up `data.json` + `data/covers/` first.
</details>

## Known Limitations

<details>
<summary>Click to expand</summary>

- Scanned PDFs have no text layer (no OCR).
- Cross-page PDF selections save as two separate highlights.
- PDF "back to source" link lands on the right page but may need a small scroll to align (no subpath offset support in Obsidian PDFView yet).
- Large MOBI files block the main thread for 2 – 5 s (known issue).
- Cross-page TXT excerpts not supported (single-page rendering).
- Android untested.
- AZW declared but no reader yet.
- GBK / GB18030 TXT files need manual re-encoding to UTF-8.
- Translation providers see whatever you select — keep sensitive content out of selections.

</details>

## Privacy

- **Source files are read-only** — never copied, moved, or deleted.
- All state (bookmarks, excerpts, favorites, progress, settings, cover cache index) lives in `<Vault>/.obsidian/plugins/ez-reader/data.json`.
- Cover images cache into `<Vault>/.obsidian/plugins/ez-reader/data/covers/`.
- Per-book Markdown notes go to the configured `notesDirectory` (default `ezreader-notes/`, auto-created on first save — no `mkdir` needed).
- Translation is the only outbound network action, and only on explicit user action.

## Architecture

Strict core / adapters / ui port-and-adapter layers. `core/` is pure logic with no Obsidian imports; `adapters/` wraps Obsidian / foliate / mobi-parser / translation providers; `ui/` is DOM rendering. Tests cover only `core/` (`tests/core/*.test.ts`, 307 / 307 passing).

## Development

```bash
pnpm test           # 307 / 307 unit tests
pnpm run build      # type-check + esbuild bundle
pnpm run dev        # watch mode (Obsidian-side reload required)
```

Change locally, verify in your vault, then `git commit && git push`. The release workflow (`.github/workflows/release.yml`) builds and uploads the three plugin files on every tag.

## License

[MIT](LICENSE) © [alei37](https://github.com/alei37). Third-party components retain their respective licenses — see [`LICENSES/`](LICENSES).

中文版 [README.zh-CN.md](README.zh-CN.md) · 详细变更 [CHANGELOG.md](CHANGELOG.md)