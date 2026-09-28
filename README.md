# EzReader

Read local ebooks in Obsidian — progress tracking, highlights, research notes, optional online translation.

![Personal shelf](docs/screenshots/shelf.webp)

> Shelf: grid view, status pill (Reading / Finished / Abandoned / Not started), cover + title + path + progress + format + ★ favorite.

## Quick Start

Get your first book open in five minutes.

1. **Install** — Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/alei37/ez-reader/releases/latest) and drop them into `<Vault>/.obsidian/plugins/ez-reader/`. Or build from source (`pnpm run build`).
2. **Enable the plugin** — Open Obsidian → Settings → Community plugins → enable **EzReader**. The onboarding modal appears the first time.
3. **Open the Shelf** — Click the 📚 ribbon icon on the left, or run "EzReader: Open Shelf" from the command palette.
4. **Add books** — Click "+ Add" in the toolbar, pick EPUB / PDF / TXT / MOBI / AZW3 files from your Vault, confirm. Covers are auto-extracted. Don't want to pick one by one? Hit "Add All" to scoop up everything detected.
5. **Read** — Click any cover on the Shelf to open the reader. If you've read it before, you land on your last position. After 180 ms of selection, the [Thought / Excerpt / Translate / Copy] menu pops up.

For the full key map, press `?` inside the reader. The most common shortcuts are `H` (quick highlight), `B` (quick bookmark), `S` (notes sidebar), `T` (TOC), `← / →` (page), `Esc` (close panel).

## Data Flow

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Shelf                                                               │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐  ┌─ Status ─┐  ┌─ Sort ─┐  [+ Add All]  │
│  │Cov.│ │Cov.│ │Cov.│ │Cov.│  │ □ Reading│  │ Title ↑ │               │
│  └────┘ └────┘ └────┘ └────┘  │ □ Done   │  │ Added ↓  │              │
│  Alice   The Little Prince …    └──────────┘  └─────────┘              │
└──────────────────────────────────────────────────────────────────────┘
                          │ click cover
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Reader                                                              │
│  [📑]  [Reading]  [★]  [◀] ▬▬▬▬▬ 42% [▶]  [Aa]  [📝]  [⛶]      [×]   │
│                                                                       │
│   "All grown-ups were once children — only very few remember it."      │
│   ──────────────────────────────                                     │
│   Chapter 1 · 27%                                                      │
│                                                                       │
│  [Selected text]                                                      │
│   ┌─────────────────────┐                                            │
│   │ Thought │ Excerpt │ Translate │ Copy │                          │
│   └─────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────┘
                          │  Thought / Excerpt
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ezreader-notes/Reading Notes/little-prince-abcd1234.md              │
│ ---                                                                  │
│ title: "The Little Prince"                                            │
│ ez-reader: /books/le-petit-prince.epub                                │
│ ---                                                                  │
│                                                                      │
│ > [!quote] Excerpt                                                    │
│ > **The Little Prince** · Chapter 1 · 27% · EPUB                     │
│ > Created: 2026-01-15 21:34                                          │
│ > Open in reader: [Open](obsidian://ez-reader?book=…&annotation=…)    │
│ >                                                                    │
│ > All grown-ups were once children — only very few remember it.      │
│                                                                    ^
│ ex-…                                                                 │
```

> Reader toolbar: the TOC icon (`📑`) lives at the far left, the close icon (`×`) at the far right. In between: status pill / ★ / navigation + progress slider / font size / notes / immersive. All buttons are lucide icons; layout is shared between desktop and mobile.

## Features

### Shelf

- **Manual add** — Pick books and confirm; EzReader does not auto-scan (so a packed vault won't surprise you). Title / author / language are read from EPUB / PDF metadata.
- **Two views** — Grid (cover cards) or List (detailed rows). `G` toggles in the toolbar; the keyboard sequence `g g` (Gmail-style) also works.
- **Status tracking** — Each book is tagged `Not started / Reading / Finished / Abandoned`. Click the status pill to cycle through them. `★` is a separate favorite flag.
- **📌 Pin to top** — A pin icon sits in the top-right of every grid cover; one click toggles. Pinned books float above the rest regardless of sort.
- **Filters + sorts**:
  - Status, language, format, progress bucket (Unread / Early / Middle / Late / Done), recently opened (Today / Week / Month / Older / Never)
  - Title ↑/↓, author initial, added time, recently opened, reading progress
  - Top-of-shelf search box matches title / author / identifier / path
- **Cover cache** — Asynchronously extracted on import (EPUB via foliate-js, PDF via Obsidian's built-in pipeline) and persisted to the plugin folder. Covers are reused on next vault launch — no re-extraction.

### Reader — EPUB (`ReaderView`)

- **Rendering**: [foliate-js](https://github.com/johnfactotum/foliate-js) 1.0.1, with two-page / scroll modes and automatic progress across chapters.
- **Appearance** (toolbar `Aa` button or `Shift+H`):
  - Font size 60 % – 200 %
  - Line height 1.0 – 2.4
  - Margin 0 – 80 px
  - Theme: System / Light / Dark / Sepia
  - Flow: paginated / scrolling
- **Immersive mode** (`Shift+F`): on tablet and desktop, the toolbar hides. Swipe down from the top 80 px, mouse-in, or touch to bring it back. On tablets you can have it auto-enter on launch.
- **Progress memory**: on by default, can be turned off. Books reopen at the last CFI / page.
- **Chapter title strip**: the nav-group header keeps the current chapter visible as a thin strip above the text, WeRead-style.
- **Table of Contents panel** (`T`):
  - 380 px sidebar on the left, tree layout (`▾` / `▸` to collapse, indent + vertical line connecting parents and children).
  - **Keyboard navigation**: `↑↓` to move focus, `Home` / `End` to jump to the first / last visible row, `←` / `→` to collapse or jump to parent, `Enter` / `Space` to jump, `Esc` to close.
  - **Breadcrumb**: a dedicated row at the top of the panel shows the ancestor chain (`Chapter 2 › 2.1 › 2.1.2`). Any ancestor is clickable.
  - **Progress dots**: a 6 px dot at the end of each row — green = visited, blue = current, gray = unvisited. Visited chapters are persisted to `data.json` (survives closing the viewer and restarting Obsidian).
  - **Auto-scroll**: opening the panel scrolls the active row into view. The search box wraps matches in `<mark>` highlights.
- **Multi-device sync**: status, bookmarks, excerpts, and notes all live in your vault's `data.json` plus Markdown notes. Sync them through Syncthing, git, or Obsidian Sync (everything outside `.obsidian/`).

### Reader — PDF (`PdfOverlay`)

EzReader does not render PDFs itself — it defers to Obsidian's built-in `pdf` view and layers a transparent overlay on top. Standard `[[path.pdf]]` links work, and the plugin coexists with [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) and similar enhancers.

The overlay (`PdfOverlay`) provides:

- **Selection menu** — Translate / Excerpt / Copy / Thought.
- **Translation popover** (replacing the 10 s `Notice` toast): anchored to the selection rect, showing source text (italic gray) on top and translation (main color) below, plus provider metadata (e.g. `detected: en · youdao · → zh-CN`). Inline [Copy] [Change target language] × buttons; **the header is draggable** so you can park it anywhere on screen (clamped inside the viewport). Click outside, ×, or `Esc` to dismiss.
- **Floating 📝 button** → notes sidebar (bookmarks + excerpts list, jump back to source). **The button itself is draggable** — its position is persisted per book via `localStorage`, so it stays where you put it across Obsidian restarts.
- **Highlight echo**: when you reopen a PDF, yellow highlight rectangles are automatically drawn on each page by matching page + text anchors. Multi-line and multi-word excerpts both render correctly.
- **Cross-page selections**: this version saves selections per page; a selection that crosses a page break is saved as two independent highlights, one per visible page.
- **Auto-attach on restart**: when Obsidian restores previously open PDF leaves, `PdfOverlay` waits for `onLayoutReady` and scans all open PDFs — for every book on the shelf it finds, the overlay is attached. PDFs opened from backlinks, global search, or the file browser also get attached via the `active-leaf-change` listener. You should never see "PDF translations don't work after restart" — if you do, check the console for a `PdfOverlay not found` warning (usually means a third-party PDF plugin is interfering).
- **PDF highlight click → notes**: clicking an existing PDF highlight opens the notes sidebar, jumps to the matching excerpt, and enters inline note edit mode so you can refine your thought immediately.

### Reader — TXT / MOBI / AZW3 (`PagedTextSession`)

Three plain-text / chapter-text formats share one session engine (`PagedTextSession`). UX is identical to EPUB — same selection / excerpt / highlight / page-turn / theme.

- **TXT** — UTF-8 plain text, paginated by paragraph (default 1600 chars / page). Paragraphs are never split mid-way unless a single paragraph exceeds a page (in which case we hard-cut at sentence boundaries — both Chinese and Western punctuation). All HTML-special characters are escaped.
- **MOBI / AZW3** — Parsed by [@lingo-reader/mobi-parser](https://github.com/lingo-reader/mobi-parser). One chapter per page, embedded images and CSS are injected automatically. TOC, chapter progress, and page-turn animation match EPUB.
- **Progress persistence** — Locator: `{ kind: "text", fraction, start, end }` → `paged-text:<pageIdx>`. Close and reopen to land on the original page.
- **What we don't do**:
  - TXT has no cover (the shelf uses a placeholder).
  - GBK / GB18030 encoding is **not** auto-recognized — re-save the file as UTF-8 first.

### Selection Menu

After 180 ms of selection, a four-button menu pops up: `Thought | Excerpt | Translate | Copy`. Each button shows its keyboard hint as a small line under the label, so you can discover shortcuts without pressing `?`.

- **Thought** — A free-form note tied to the current chapter / position, written into a callout in the note. Shortcut: `Shift+T`.
- **Excerpt** — Highlight + note. Optional tags (`#AI` `#methodology`) and your own comment. Shortcut: `Shift+H` opens the modal. To skip the modal entirely, press bare `H` — the excerpt is saved and highlighted immediately, with no tags or note input.
- **Translate** — Uses the configured translation provider (see below). Only the selected fragment is sent; no surrounding context. Shortcut: `Shift+T` (same key as Thought — context disambiguates).
- **Copy** — Writes the selection to the system clipboard and shows a character-count Notice. Shortcut: `C`.

For Chinese text the browser tokenizes per character, which produces too many tiny segments. When the menu fires, we automatically expand the selection to the nearest full stop / comma / line break (cap 100 chars) so Thought / Excerpt feel meaningful.

## Common Tasks

Step-by-step recipes. Each entry says "Goal → Steps → Result".

### 1. Highlight a sentence and save an excerpt (with a note)

**Goal**: Select text → menu → pick [Excerpt] → modal asks for note + tags → entry appears in the notes sidebar.

1. While reading, select a passage with mouse / touch.
2. Wait 180 ms — the selection menu appears below the selection.
3. Click `Excerpt (Shift+H)`, or press `Shift+H` immediately after selecting to skip the menu.
4. The modal asks for a note and optional tags (space-separated, e.g. `#methodology #AI`).
5. Click [Save]. The modal closes, the text turns yellow, and the notes sidebar (`S`) gets a new entry.

**Result**: Highlight + excerpt + your note are saved into `<notesDirectory>/<book-title>-<id>.md`, with an Obsidian block ID for backlink.

### 2. Quick bookmark (no modal)

**Goal**: Press bare `B` while reading.

1. At any moment in the reader, press `B`.
2. A bookmark lands instantly at the current chapter + position (auto-labeled `Chapter 3 · 42%`).

**Result**: The notes sidebar (`S` → "Bookmarks" tab) gets a new entry; one click later to jump back.

### 3. Jump to a chapter via the TOC

**Goal**: `T` opens the TOC → navigate with the keyboard → jump.

1. Press `T` (or click 📑 at the far left of the toolbar). The 380 px TOC panel opens.
2. `↑↓` to move focus, `Home` / `End` to jump to the first / last row, `Enter` / `Space` to jump to the focused row.
3. On a parent row: `→` expands, `←` collapses. On a leaf row: `←` jumps to its parent.
4. The header's dedicated breadcrumb row (`Chapter 2 › 2.1 › 2.1.2`) lets you click any ancestor to jump.
5. Type in the top search box — matching substrings inside labels are wrapped in `<mark>`.
6. Each row's tail dot shows progress: green = visited, blue = current, gray = unvisited. Visited state is persisted across Obsidian restarts.
7. `Esc` closes the panel.

### 4. Translate a word

**Goal**: Select text → [Translate] → translation appears.

1. First, configure a translation provider under Settings → EzReader → Translation (see [Translation](#translation)). Until you do, the button throws — by design.
2. Select a word or phrase → 180 ms later, pick [Translate].
3. **EPUB / TXT / MOBI**: a drawer slides in from the right with the result. `max-height: 50vh` — long translations scroll inside, never push the page.
4. **PDF**: a small popover appears near the selection (it doesn't squeeze the PDF view). Source text in italic gray on top, translation in main color below, provider metadata under it (`Seen: en · youdao · → zh-CN`).
5. Click [Copy] to copy the translation to the clipboard. The button briefly turns ✓ Copied, then reverts after 1.5 s.
6. **The PDF popover is draggable** — grab the header (avoid the × button) and move it anywhere inside the viewport; it auto-clamps so you can't lose it off-screen. Click outside / × / `Esc` to close.
7. **PDF popover [Change target language]** cycles through `zh-CN → en → ja → ko → fr → de → zh-CN`, retranslating on every click.

**Note**: Translation is the **only** feature that leaves your vault. It runs only when you actively click the button; we send only the selected fragment, never the file, surrounding context, or any user identifier. See [PRIVACY.md](PRIVACY.md).

### 5. Edit an existing excerpt's note

**Goal**: Notes sidebar → click the note text → dashed border indicates edit → save on blur.

1. Press `S` to open the notes sidebar and find the entry.
2. By default the note is collapsed and shows a preview with a `▸`. Click `▸`, or just click the note text itself.
3. The note enters contenteditable with a dashed border; select all to overwrite.
4. Click elsewhere (blur) to auto-save; or `Cmd/Ctrl + Enter` to force-save. `Esc` cancels and restores the original text.

**Result**: Only the `note` field is patched. The highlight, `createdAt`, and source text are not rewritten, and the Markdown note in your vault updates in lockstep.

### 6. Change a book's status

**Goal**: On the shelf, click a book's status pill (Reading) to cycle.

1. Find the book on the shelf (grid or list view). The status pill shows `Reading`.
2. Click the pill — it cycles through `Reading → Finished → Abandoned → Not started → Reading`.
3. Want a specific status? Right-click → context menu offers "Mark as Finished / Reading / Abandoned" as direct jumps.

**Result**: Status is saved immediately; the reader toolbar (and the shelf pill) reflect it on next open. Reading progress auto-infers: `updatePosition` marks books Finished at ≥ 95 % and Not started at < 0 (e.g. explicit reset).

### 7. Pin a book to the top

**Goal**: Click the pin in the top-right of a grid cover to pin.

1. In grid view, find the book you want pinned. By default the top-right has no pin.
2. **Pin**: click the `📌` icon → the book jumps to the very front of the shelf (`onTogglePin` handler — no menu).
3. **Unpin**: click the same `📌` again → it returns to its sorted position.

**Result**: Shelf re-sorts with pinned books first. The right-click menu also exposes "✓ Pinned" / "Pin to top".

### 8. Configure translation

**Goal**: Settings → EzReader → Translation → pick a provider → fill in the key.

1. Settings → Community plugins → EzReader → gear icon → Translation section.
2. Translation service dropdown — pick one provider. Choose `Off` to disable translation entirely.
3. Fields change per provider — fill only the relevant ones:
   - **Youdao** — two password fields for `appKey` and `appSecret` (merged under the hood, don't try to hand-write JSON).
   - **DeepL** — one password field; paste your Pro/Free Authentication Key (Free keys end in `:fx`).
   - **Google Cloud Translation v3** — one password field; paste the entire service-account JSON contents.
   - **MyMemory (free, no signup)** — no key needed. Pick it and you're done — 10 000 chars / IP / day.
   - **Custom LLM (OpenAI-compatible)** — three fields: API base URL, API key, model name. Examples at the bottom of the section cover DeepSeek, Zhipu GLM, Qwen, and OpenAI.
   - **Custom LLM (Anthropic-compatible)** — same three fields; designed for endpoints following the Anthropic Messages API (e.g. `https://api.minimax.cn/anthropic`).
4. Switching providers wipes the old key (formats aren't interchangeable) — nothing stale stays behind.
5. Target language defaults to `zh-CN`; change it any time.

**Result**: The [Translate] button in the selection menu works immediately. Provider / key changes take effect within 30 s (translation cache is invalidated instantly).

**Free tier comparison:**

| Provider | Free quota | Key required |
|---|---|---|
| Youdao | 100 chars / month (≈ none) | ✅ appKey + appSecret |
| DeepL Free | 500 000 chars / month | ✅ (`:fx` suffix) |
| Google Cloud Translation v3 | 500 000 chars / month | ✅ service-account JSON + card on file |
| **MyMemory** | 10 000 chars / IP / day | ❌ none |
| Custom LLM | depends on your balance | ✅ |

> The truly zero-signup, zero-card route is **MyMemory** (quality is lower) or **Custom LLM** with your own key.

## Keyboard Shortcuts

| Action | Default key | Notes |
|---|---|---|
| Previous page | `←` / `PageUp` / `Shift+Space` | |
| Next page | `→` / `PageDown` / `Space` | |
| Jump to first / last | `Home` / `End` | |
| **Quick highlight** (no modal) | `H` (bare) | After selecting text — instant excerpt + yellow highlight, no input |
| **Quick bookmark** (no modal) | `B` (bare) | One keypress; label = `Chapter · %` |
| Save excerpt (modal) | `Shift+H` | Opens note + tags modal |
| Translate selection | `Shift+T` | Drawer / popover slides out |
| Thought (no selection needed) | `Shift+T` | Same key as Translate — context decides |
| Copy selection | `C` | |
| Toggle notes sidebar | `S` | |
| Toggle TOC | `T` | |
| Toggle immersive mode | `Shift+F` | (lowercase `f` no longer responds — avoids foliate's internal find) |
| Show shortcut help | `?` | Grouped table modal; footer shows your custom key bindings |
| Exit / close panel | `Esc` | Not intercepted — Obsidian defaults still work |

`prev` / `next` / `translate` / `highlight` / `toggleSidebar` / `toggleToc` are remappable in Settings.

**Inside the TOC panel**: `↑↓` to move focus, `Home` / `End` to jump to first / last, `←` / `→` to collapse or jump to parent, `Enter` / `Space` to jump, `Esc` to close (press `?` for the full table).

## Translation

Optional, network-required. The only feature that leaves your vault, and only when you actively trigger it. Boundaries are spelled out in [PRIVACY.md](PRIVACY.md).

- **Off by default** — Without a configured provider, `translate` throws on click. **MyMemory is the exception**: it's a public API and needs no key.
- **Only the selected fragment is sent** — never the file, never surrounding context, never a user identifier.
- **Config is local**: `<Vault>/.obsidian/plugins/ez-reader/data.json`. Sent only to the matching provider's auth endpoint.
- **Network layer is Obsidian's `requestUrl`** — bypasses the renderer CSP (plain `fetch()` is blocked inside Obsidian plugins).
- **Six configurable providers**:

| Provider | Type | Key required | Free quota | Notes |
|---|---|---|---|---|
| **Youdao** | Commercial API | appKey + appSecret | 100 chars / month | Stable inside mainland China |
| **DeepL** | Commercial API | API Key (`:fx` = Free) | 500 000 chars / month (Free) | High quality |
| **Google Cloud Translation v3** | Commercial API | Service Account JSON | 500 000 chars / month | Card on file required |
| **MyMemory** | Public free API | ❌ none | 10 000 chars / IP / day | Truly zero signup; quality is lower |
| **Custom LLM (OpenAI-compatible)** | Bring your own key | baseUrl + API Key + model | your balance | DeepSeek / Zhipu / Qwen / OpenAI |
| **Custom LLM (Anthropic-compatible)** | Bring your own key | baseUrl + API Key + model | your balance | Anthropic-Messages-compatible endpoints (e.g. MiniMax) |

- **Target language** comes from Settings, default `zh-CN`.

Switching providers wipes the old key — formats are not interchangeable, leaving stale values around only confuses things. Config changes take effect on the next translation (the cache is invalidated instantly).

## Platform Support

- **Desktop** (Windows / macOS / Linux): Obsidian's bundled Chromium — everything is enabled.
- **Mobile** (Android / iOS): Obsidian's bundled WebView. Older Android WebViews lack `Object.groupBy` / `Promise.withResolvers`; the plugin ships a polyfill bundle as a safety net.
- **Minimum Obsidian version**: 1.12.7.

## Supported File Formats

- **EPUB** (`.epub`) — Full support via foliate-js (with the customElements patch).
- **PDF** (`.pdf`) — Obsidian's built-in viewer + EzReader's `PdfOverlay` (selection / notes / highlight echo).
- **TXT** (`.txt`) — Plain UTF-8 text. `TxtBookReader` paginates by paragraph (1600 chars / page default, paragraphs never split), renders into `PagedTextSession`.
- **MOBI / AZW3** (`.mobi` / `.azw3`) — Mobipocket and Kindle Format 8. `MobiBookReader` wraps `@lingo-reader/mobi-parser`; one chapter per page; embedded images and CSS handled natively.
- **AZW** (`.azw`) — Type is declared but no reader exists yet. Shelf scan filters these out, so the file never shows up. Adding one is a single-line change to `READER_CAPABLE_FORMATS`.

## Architecture

Strict core / adapters / ui boundaries, ports-and-adapters style.

```
core/        (pure logic, zero Obsidian imports)
   ├─ entities/    Book, Bookmark, Excerpt, ReadingState
   ├─ ports/       BookSource, BookReader, AnnotationStore, TranslationProvider, NoteWriter
   ├─ services/    LibraryService, ReadingService, TranslationCoordinator
   └─ types/       ReaderSettings, ShelfFilter, Locale

adapters/     (Obsidian / foliate / mobi-parser implementations)
   ├─ obsidian/    ObsidianBookSource, ObsidianAnnotationStore, CoverCache, ObsidianNoteWriter
   ├─ foliate/     FoliateBookReader (EPUB)
   ├─ text/        TxtBookReader (TXT) + MobiBookReader (MOBI/AZW3) + PagedTextSession (shared)
   └─ translation/ YoudaoTranslationProvider, DeeplTranslationProvider, GoogleTranslationProvider,
                   MyMemoryTranslationProvider, OpenAICompatibleTranslationProvider,
                   AnthropicCompatibleTranslationProvider, BaseTranslationProvider

ui/           (DOM rendering, user interaction)
   ├─ shelf/       ShelfView, ShelfToolbar, ShelfFilters, AddToLibraryModal, OnboardingModal
   ├─ reader/      ReaderView, ReaderToolbar, AppearanceModal, ReaderSelectionMenu, BookmarksPanel,
   │               ExcerptsPanel, SidebarNotesPanel, TocPanel, TranslationDrawer, pdfOverlay
   └─ settings/    SettingsTab

platform/     (Obsidian runtime polyfills)
Plugin.ts     (wires every dependency)
```

Hard rules:

- `core/` never imports `"obsidian"`.
- `core/ports/*` are interfaces — implementations live in `adapters/`.
- `ui/` talks to `core/` through ports; it does not read files directly.

Tests cover only `core/` (`tests/core/*.test.ts` → `tests/dist/core/*.mjs` → `node --test`). They do not boot the Obsidian runtime.

## Privacy & Data Storage

- **Source files are read-only** — never copied, moved, renamed, or deleted.
- **State, bookmarks, excerpts, favorites, pins, progress, settings, first-added timestamps, and the cover-cache index** all live in `<Vault>/.obsidian/plugins/ez-reader/data.json`.
- **Cover images** cache into `<Vault>/.obsidian/plugins/ez-reader/data/covers/`. Deleting them doesn't affect anything else (they're re-extracted next time you open a book).
- **Per-book Markdown notes** are written to the user-configured `notesDirectory`, with Obsidian block IDs for two-way linking.
- The default location is `ezreader-notes/` at the Vault root (with `ezreader-notes/Reading Notes` for excerpts and `ezreader-notes/Topic Research` for theme notes). The directory is auto-created on first save by `ObsidianNoteWriter.ensureDirectory` — no manual `mkdir` needed.
- Translation is the only network action, and it runs only when you actively trigger it.

## Known Limitations

- **Scanned PDFs have no text layer** — EzReader does not run OCR.
- **No automatic book management** — we never rename, merge, move, or delete book files.
- **Cross-page PDF selections** are not supported — each page is independent, cross-page selections become two highlights (one per visible page).
- **PDF "back to source" link** jumps to a page (`#page=N`) but not to a precise subpath (the 4-tuple begin/end offset). It needs Obsidian's PDFView to publish that API. Current behavior: you land on the right page with the highlight in the right place; sometimes you have to scroll a bit to see it.
- **Third-party PDF plugins** (PDF++, etc.) may alter the PDFView DOM, so `PdfOverlay` fails to attach. Page jumps fall back to `setEphemeralState` and you'll see a `handleProtocol: PdfOverlay not found` console warning. Reading still works.
- **Large MOBI files (> 5 MB)** block the main thread for 2 – 5 s during `createParser` sync decompression. Known issue — next pass moves decompression into a Web Worker.
- **Cross-page TXT excerpts** aren't supported — `PagedTextSession` renders one page at a time, and the browser's selection only sees visible DOM.
- **Android is untested.** foliate iframe behavior on Android WebView may differ.
- **AZW** has no reader yet — type declared, shelf scan filters out, will activate with a one-line change to `READER_CAPABLE_FORMATS`.
- **TXT assumes UTF-8** — GBK / GB18030 files must be re-saved as UTF-8 first.
- Translation providers see whatever you select — keep sensitive content out of selections.

## FAQ

**Q: PDF opens, but no notes sidebar / no selection menu?**

**A**: Almost certainly a third-party plugin (PDF++ etc.) is taking over Obsidian's PDFView and changing its DOM, so `PdfOverlay` cannot attach. Check the console for `[ez-reader] handleProtocol: PdfOverlay not found`. Reading is unaffected — page jumps fall back to `setEphemeralState` / `openLinkText("#page=N")`. As a test, temporarily disable PDF++; we may add explicit compatibility later.

**Q: Opening a large MOBI freezes the UI for 2 – 5 s?**

**A**: Known issue. `@lingo-reader/mobi-parser`'s `createParser` is a synchronous decompressor. Tracked as P1 polish — the next version moves decompression into a Web Worker. Small files (< 5 MB) are fine.

**Q: TXT shows mojibake / garbled characters?**

**A**: The plugin only reads UTF-8. Re-encode GBK / GB18030 files as UTF-8 (VSCode / Notepad++) before importing. `decodeText` runs strict UTF-8 → GB18030 → permissive UTF-8 internally, so some GBK files work automatically, but it's not guaranteed.

**Q: Translation does nothing / says "API key not configured"?**

**A**: Settings → EzReader → Translation → pick one → fill the API key. **Throwing on missing key is intentional** — we never silently send text to a default endpoint. See [PRIVACY.md](PRIVACY.md).

**Q: Progress doesn't sync to my Android tablet?**

**A**: Syncthing excludes `.obsidian/` by default — **including** `data.json`. Configure Syncthing to also sync `<Vault>/.obsidian/plugins/ez-reader/data.json`. Notes already live in `notesDirectory` (a Vault-root folder by default, outside `.obsidian/`), so they sync automatically.

**Q: How do I backlink to an excerpt from another note?**

**A**: Each excerpt gets an Obsidian block ID (`^ex-uuid`). In any note, write `[[book-note#^<excerptId>]]` and Obsidian previews the excerpt inline. Or click "Back to this excerpt" on the excerpt card to copy the block-ID link and paste it where you want.

**Q: Will upgrading the plugin wipe my data?**

**A**: No. All state lives in `<Vault>/.obsidian/plugins/ez-reader/data.json`. Upgrading only swaps `main.js` + `manifest.json` + `styles.css`. New schema fields are always optional with safe fallbacks, so older `data.json` files keep working — missing fields get default values.

**Q: How do I uninstall completely?**

**A**: Delete `<Vault>/.obsidian/plugins/ez-reader/` entirely. **Heads up**: `data.json` and `data/covers/` live in there, so deleting the folder wipes all bookmarks, excerpts, progress, favorites, and the cover cache. If you want to keep them, back up `data.json` and `data/covers/` first. Reinstall + drop the backups back in → data restored instantly.

## Installation

### Recommended: GitHub Release

Download the zip from [Releases](https://github.com/alei37/ez-reader/releases) and place the three files inside:

```
<Vault>/.obsidian/plugins/ez-reader/
├── main.js
├── manifest.json
└── styles.css
```

Then launch Obsidian → Settings → Community plugins → enable **EzReader**.

### Build from source

Requires Node.js ≥ 22.13.0 and pnpm ≥ 11.9.0.

```bash
pnpm install --frozen-lockfile
pnpm run build     # produces main.js / styles.css / manifest.json
```

Deploy to your local vault:

```bash
cp main.js styles.css manifest.json /path/to/<Vault>/.obsidian/plugins/ez-reader/
```

## Development Workflow

```bash
pnpm test            # unit tests (307/307 passing, 29 .test.ts files)
pnpm run build       # type-check + esbuild bundle
pnpm run dev         # watch mode (main process — requires Obsidian-side reload)
pnpm run dev:web     # watch mode (client-plugin)
```

After changing code: `pnpm run build` → `cp` the three files to your vault plugin folder → in Obsidian press `Ctrl/Cmd + P` → "Reload app without saving".

We don't commit / push directly — change locally, get user verification, then `git add . && git commit && git push`.

## Credits & License

- Author: [alei37](https://github.com/alei37)
- License: [MIT](LICENSE)
- Third-party components retain their respective licenses — see [`LICENSES/`](LICENSES)

中文版 README 看 [README.zh-CN.md](README.zh-CN.md). 详细版本变更看 [CHANGELOG.md](CHANGELOG.md)。