# EzReader

EzReader is an Obsidian plugin for reading and organizing personal ebooks in
the active Vault. It keeps ebook handling local, treats original ebook files as
read-only input, stores research results as normal Markdown, and adds optional
cloud-backed selection translation.

## What it does

- Opens unencrypted EPUB, MOBI, AZW, AZW3, TXT, and PDF files from the active
  Vault.
- Provides a manual, resumable Personal Library scan with search and filters.
- Saves reading progress, bookmarks, excerpts, reader appearance, and
  plugin-owned backups locally.
- Creates reading and research Markdown notes only when the user asks.
- Supports local PDF rendering with a bundled offline worker.
- **Optional**: select text inside a book and translate it through a cloud
  translation provider (see "Translation" below).

## Platforms

EzReader is built on top of `v0.3.6` of [Sunny D's Local Book
Reader](https://github.com/SunnyD0697/local-book-reader), then adapted for
mobile and tablet WebViews. It targets Obsidian `1.12.7` or newer on:

- **Desktop** (Windows, macOS, Linux) — Obsidian's bundled Chromium.
- **Mobile** (Android, iOS) — Obsidian's bundled mobile WebView.
  - Older Android WebViews may ship without Chrome 117 APIs (notably
    `Object.groupBy` and `Promise.withResolvers`). EzReader ships a small
    polyfill bundle that covers this gap.

## Translation

Selection translation is the single feature that intentionally uses the network.
It is off by default and only fires when the user explicitly invokes it on a
piece of selected text.

- The plugin never reads or transmits your ebook file. Only the selected
  fragment is sent, and only at the moment you trigger the action.
- You must supply your own API key for the translation provider. The key is
  stored in Obsidian's plugin settings (`data.json` inside the plugin
  directory) and is never sent anywhere except to the provider you configure.
- Default provider is configurable. Initial release ships with a configurable
  endpoint that targets `https://translation.googleapis.com` (Google Cloud
  Translation v3); alternative providers can be added later.
- Disabling the feature in settings removes any network access; the plugin
  remains a strict offline reader.

When translation is enabled, the privacy promise changes from "no network
requests ever" to "no network requests except the translation calls you
explicitly make". See [PRIVACY.md](PRIVACY.md) for the exact boundaries.

## Install, upgrade, and uninstall

Download the plugin ZIP from the GitHub Release for the version you want, or
build it from source (see below). The runtime artifacts are `main.js`,
`manifest.json`, and `styles.css`. Install into
`<Vault>/.obsidian/plugins/ez-reader/`, then enable **EzReader** in Obsidian
Community plugins.

Test the preview first in a separate Vault with non-sensitive sample books.

### Migrating from Local Book Reader

If you previously used Local Book Reader (plugin id `local-book-reader`),
EzReader is a separate plugin and does **not** automatically import your old
library, progress, bookmarks, or excerpts. To move your data:

1. In the old plugin, export a core-data backup (Settings → 导出核心数据备份).
2. Disable and uninstall the old plugin (keep the backup file and your
   `<Vault>/.obsidian/plugins/local-book-reader/data/` directory for safety).
3. Install EzReader into `<Vault>/.obsidian/plugins/ez-reader/`.
4. Open EzReader settings and pick **从备份恢复核心数据**, then choose the
   exported JSON.
5. Re-scan the Personal Library once to rebind files to the new book records.

Book files themselves never need to move — EzReader reads them from wherever
they were in the previous plugin.

## Build from source

Use Node.js `22.13.0` or newer and pnpm `11.9.0`:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

The production runtime artifacts are `main.js`, `manifest.json`, and
`styles.css`. The PDF Worker is bundled inside `main.js`, so the build follows
the standard Obsidian community-plugin installation layout. Do not commit
generated runtime artifacts; they belong in GitHub Release attachments.

## Known boundaries

- Distributed through GitHub Releases (and, once reviewed, the Obsidian
  community-plugin directory).
- Scanned-image PDFs do not provide OCR.
- Automatic ebook organization, renaming, moving, merging, and deletion are
  deliberately excluded.
- The translation provider sees the fragments you select; do not select
  sensitive text if that is a concern.

## Author

Created and maintained by [alei37](https://github.com/alei37). Derived from
Sunny D's [Local Book Reader](https://github.com/SunnyD0697/local-book-reader)
`v0.3.6`.

## License

EzReader is licensed under the [MIT License](LICENSE). Bundled third-party
components retain their respective licenses.