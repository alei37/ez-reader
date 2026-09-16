import { TFile, normalizePath, type App } from "obsidian";
import type { Plugin } from "obsidian";
import type { Book, BookFormat } from "../../core/entities/Book";
import type { BookReader } from "../../core/ports/BookReader";
import type { LibraryService } from "../../core/services/LibraryService";

/**
 * Adapter map keyed by the formats each reader supports. A format with
 * no entry in this map means "no cover extraction possible" — the shelf
 * falls back to a generated placeholder.
 *
 * P1-5: the previous `ReadonlyArray<BookReader>` shape forced CoverCache
 * to try every reader on every book (Foliate→Txt→Mobi for a TXT book).
 * That wasted 3 IO calls per non-EPUB file and spammed console.warn when
 * the mobi reader threw on non-MOBI bytes. Keying by format picks the
 * right reader in O(1) and lets the caller control the mapping
 * (e.g. sharing one reader across MOBI + AZW3).
 */
export type CoverReaders = Partial<Record<BookFormat, BookReader>>;

/**
 * Owns the plugin-side book cover cache: extracts a cover image out of a
 * book's bytes, writes it under `<plugin>/data/covers/`, and hands back
 * the Obsidian `app://` resource URL the shelf can use as an <img> src.
 *
 * The cache is best-effort: a failure during extraction never throws back
 * into the reader — we just leave the book's `coverPath` null and let the
 * shelf fall back to a generated placeholder.
 */
export class CoverCache {
  private readonly coversDir: string;
  private readonly app: App;
  private readonly plugin: Plugin;
  private readonly library: LibraryService;
  /**
   * Adapter map keyed by format. PDF is intentionally absent — Obsidian's
   * built-in viewer handles PDF cover rendering on its own.
   */
  private readonly readers: CoverReaders;
  private readonly annotations: import("../../core/ports/AnnotationStore").AnnotationStore;
  private readonly inFlight = new Set<string>();

  constructor(
    app: App,
    plugin: Plugin,
    library: LibraryService,
    readers: CoverReaders,
    annotations: import("../../core/ports/AnnotationStore").AnnotationStore
  ) {
    this.app = app;
    this.plugin = plugin;
    this.library = library;
    this.readers = readers;
    this.annotations = annotations;
    this.coversDir = normalizePath(`${app.vault.configDir}/plugins/${plugin.manifest.id}/data/covers`);
  }

  /**
   * Extract a cover for a book and write it to disk. Idempotent and
   * concurrent-safe: a single book is extracted at most once per session
   * even if multiple callers race here.
   *
   * Format routing:
   *   - EPUB → foliate-js `getCover()`.
   *   - MOBI / AZW3 → `@lingo-reader/mobi-parser` cover blob URL.
   *   - TXT → no entry in `readers` → shelf uses placeholder.
   *   - PDF → not handled here (Obsidian built-in viewer).
   *
   * If a reader throws on this format (e.g. a corrupted MOBI), we warn
   * and leave `coverPath` null — same fallback as before.
   *
   * P0 修复: 给 reader.extractCover 加 15s 超时. 之前损坏的 EPUB / MOBI 让
   * foliate.getCover() 或 mobi.initMobiFile 永远不 resolve, ensureCoverFor
   * 永不退出, inFlight 永不 delete, 所有后续的 ensureCoverFor 调用全部
   * hit cache 但 modal.confirmSelection 等 ensureCoversBatch 完成 — 整个
   * "加入所选" 卡死, 按钮永远不能再次点击. 加超时后 hang 也只是 warn + 跳过,
   * inFlight.delete 让其他并发路径仍能尝试重新提取.
   */
  async ensureCoverFor(book: Book, loader: (path: string) => Promise<ArrayBuffer>): Promise<void> {
    if (book.coverPath) return;
    if (this.inFlight.has(book.id)) return;
    this.inFlight.add(book.id);
    try {
      const reader = this.readers[book.locator.format];
      if (!reader) {
        // Format has no registered cover reader — fine for TXT / PDF.
        return;
      }
      let extracted: Awaited<ReturnType<BookReader["extractCover"]>> | undefined;
      try {
        extracted = await this.raceWithTimeout(
          reader.extractCover(book, loader),
          COVER_EXTRACT_TIMEOUT_MS,
          `extractCover(${book.locator.format})`
        );
      } catch (error) {
        console.warn(`[ez-reader] extractCover failed for ${book.locator.format} ${book.locator.path}`, error);
        return;
      }
      if (!extracted) return;
      const path = await this.writeCover(book, extracted.bytes, extracted.mimeType);
      this.library.setCoverPath(book.id, path);
      // Persist alongside the rest of the annotation data so the path
      // survives even if the covers directory goes missing.
      const current = await this.annotations.loadCoverPaths();
      await this.annotations.saveCoverPaths({ ...current, [book.id]: path });
    } catch (error) {
      console.warn(`[ez-reader] cover extraction failed for ${book.locator.path}`, error);
    } finally {
      this.inFlight.delete(book.id);
    }
  }

  /**
   * 跟 AddToLibraryModal.raceWithTimeout 同样的语义. 返回 undefined 表示超时
   * 或失败 — 调用方要据此放弃这条记录. Promise 自身不 reject, 避免在
   * Promise.all 里被一个超时拖崩所有其他并发路径.
   */
  private raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms — abandoning`);
        resolve(undefined);
      }, ms);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(undefined);
        }
      );
    });
  }

  /**
   * Extract covers for a batch of books in parallel. Concurrency is
   * capped at 3 to avoid saturating the render thread when the user
   * imports a large library.
   */
  async ensureCoversBatch(books: ReadonlyArray<Book>, loader: (path: string) => Promise<ArrayBuffer>): Promise<void> {
    const queue = books.filter((b) => !b.coverPath);
    let index = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const book = queue[index++];
        await this.ensureCoverFor(book, loader);
      }
    });
    await Promise.all(workers);
  }

  private async writeCover(book: Book, bytes: ArrayBuffer, mimeType: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(this.coversDir))) {
      await this.app.vault.adapter.mkdir(this.coversDir);
    }
    const extension = extensionForMime(mimeType);
    const safeId = book.id.replace(/[^A-Za-z0-9._-]/g, "_");
    const target = normalizePath(`${this.coversDir}/${safeId}${extension}`);
    // 直接覆盖式写到 target — vault adapter.writeBinary 是单文件写,
    // 失败时 target 保留旧内容(或完全没写过), 不会留下半成品 .writing-* 临时文件.
    // 旧实现先 remove(target) 再 rename(temp, target), 中间窗口 target 不存在
    // — 中途崩溃会丢图, 而且 .writing-* 临时文件会一直堆在 covers/ 目录里.
    await this.app.vault.adapter.writeBinary(target, bytes);
    return this.app.vault.adapter.getResourcePath(target);
  }

  /**
   * Recover cover paths for every book in the library. The source of
   * truth is the covers directory on disk: we list it and ask Obsidian
   * for a fresh resource path for each file. The persisted snapshot is
   * only used as a hint for which bookId a given slug corresponds to.
   *
   * We deliberately do not reuse the `app://...?token` URLs stored in
   * the snapshot — those tokens are session-scoped and Chrome refuses
   * to load them after the original session ends.
   */
  async hydrateCovers(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.coversDir))) {
      console.info(`[ez-reader] hydrateCovers: covers dir missing: ${this.coversDir}`);
      return;
    }
    const listing = await this.app.vault.adapter.list(this.coversDir);
    console.info(`[ez-reader] hydrateCovers: found ${listing.files.length} file(s) in ${this.coversDir}`);
    if (listing.files.length === 0) return;
    // Pre-build slug → bookId Map for O(1) lookups. 之前每次都遍历整个 library
    // (O(M×N), 几百本书 + 几十张 cover 时启动慢, 在 vault 越来越满时明显).
    const slugToBookId = this.buildSlugIndex();
    for (const filePath of listing.files) {
      // Skip `getAbstractFileByPath` — on Linux, the vault-relative path
      // returned by `adapter.list` includes a leading `.obsidian/...` that
      // `getAbstractFileByPath` does not accept, returning null. Extract
      // the slug straight from the path tail instead.
      const fileName = filePath.split("/").pop() ?? "";
      const slug = fileName.replace(/\.[^.]+$/, "");
      if (!slug) {
        console.warn(`[ez-reader] hydrateCovers: cannot extract slug from ${filePath}`);
        continue;
      }
      const bookId = slugToBookId.get(slug);
      if (!bookId) {
        // Orphan cover — vault 里没对应这本书 (用户可能删了书, 但 cover
        // 文件留在 covers/ 目录). 降级到 info 而不是 warn, 不污染用户 console.
        // 真正清理交给后续的清理工具 (不在 P0 范围).
        console.info(`[ez-reader] hydrateCovers: no matching book for slug: ${slug} (orphan, ignored)`);
        continue;
      }
      const resourcePath = this.app.vault.adapter.getResourcePath(filePath);
      this.library.setCoverPath(bookId, resourcePath);
      console.info(`[ez-reader] hydrateCovers: hydrated ${bookId}`);
    }
  }

  /**
   * Build a slug → bookId index once per hydration. LibraryService 的
   * `list()` 是已 sort 过 titleAsc 的快照 — 同样 N 本书同样的 safeId 派生,
   * 用 Map 一次 O(N) 建表后, M 个 cover 文件的查找变 O(M).
   */
  private buildSlugIndex(): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.library.list({}, "titleAsc", true)) {
      const safeId = entry.book.id.replace(/[^A-Za-z0-9._-]/g, "_");
      // 多个 book 算出同 safeId 时, 取第一个 — 这是幂等行为, 之前
      // slugToBookId 顺序遍历也是返回第一个匹配的.
      if (!map.has(safeId)) map.set(safeId, entry.book.id);
    }
    return map;
  }
}

const extensionForMime = (mime: string): string => {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".img";
};

/**
 * 单一 reader.extractCover 允许的最长执行时间. 超过就放弃这条记录 + warn.
 * 15s 在普通 EPUB 提取 (foliate 解析 ZIP + 解压第一张图) 一般 1-3s; MOBI
 * parser 创建可能要 2-5s; 损坏文件会 hang, 这条 timeout 是它们的 escape hatch.
 */
const COVER_EXTRACT_TIMEOUT_MS = 15_000;