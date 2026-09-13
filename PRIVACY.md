# Privacy

EzReader keeps most of its reading and library behaviour strictly local. The
single feature that intentionally reaches the network is **selection
translation**, and only when the user explicitly invokes it.

## What EzReader never does

- Never copies, moves, renames, or deletes original ebook files.
- Never reads files outside the Vault unless the user explicitly imports a
  backup file through Obsidian's standard file picker.
- Never starts a server, executes external programs, or collects telemetry.
- Never requires an account.
- Never transmits your full ebook to anyone.

## What EzReader does on disk

- Stores reading progress, bookmarks, excerpts, reader appearance, library
  index, and plugin-owned backups in `<Vault>/.obsidian/plugins/ez-reader/data/`.
- Caches book metadata and cover images in the same plugin directory; the cache
  can be cleared at any time without losing reading data.
- Reads ebook files directly from the Vault; only the bytes the user has
  pointed the reader at are loaded into memory.

## Selection translation (the only network feature)

When the user selects text in the reader and triggers the translation action:

1. The selected fragment (typically a word, phrase, or short sentence) is sent
   to the configured translation provider over HTTPS.
2. No surrounding context, page text, file metadata, or user identifier is
   sent.
3. The translation provider may log the request per their own privacy policy;
   EzReader does not control what the provider does with the request.
4. The user supplies their own API key, stored locally in
   `<Vault>/.obsidian/plugins/ez-reader/data.json`. The key is sent only to
   the configured provider's authentication endpoint.

When the translation feature is disabled in settings, **no network requests are
made for any reason**.

## Backup files

The user can export a JSON backup of plugin-owned data and save it wherever
they choose via Obsidian's standard save-file dialog. The backup contains
plugin settings, library index, progress, bookmarks, status, favorites, and
local excerpt/highlight location data — **never the ebook files themselves**.

## What to do if you do not want any network access

Open EzReader settings and clear the translation API key, or disable the
translation feature. Once disabled, the plugin operates entirely offline and
the only state changes happen on your local Vault.