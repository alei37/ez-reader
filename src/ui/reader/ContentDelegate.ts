import type { Book } from "../../core/entities/Book";
import type { BookBytesLoader, ReaderSession } from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";

/**
 * Mounts a book's content into a DOM host. Replaces the lower-level
 * `BookReader` interface as the unit ReaderView depends on — `ContentDelegate`
 * is allowed to do format-specific setup that doesn't belong in a generic
 * "engine" abstraction (e.g. for PDF we hook into Obsidian's `PDFView` leaf
 * instead of rendering anything ourselves).
 *
 * Contract:
 * - `mount` is called once per session. The delegate owns everything inside
 *   `host` until `destroy` is called.
 * - The returned `ReaderSession` may be a thin wrapper around Obsidian's
 *   internal classes; the host only relies on the documented session
 *   methods (`goTo`, `currentFraction`, `applyAppearance`, event hooks, …).
 *
 * Implementations:
 * - `FoliateContentDelegate` — EPUB via foliate-js (renders its own iframe).
 *
 * PDF 不走 ContentDelegate: Plugin.openReader 直接调 `openLinkText` 触发
 * Obsidian 内置 PDFView, 然后在 PDFView leaf 上挂 PdfOverlay (选词菜单 /
 * 笔记面板 / 高亮回显)。PdfOverlay 不返回 ReaderSession, 因为它不渲染
 * 内容 — 只是 overlay。
 */
export interface ContentDelegate {
  /**
   * Open the book and attach its content to `host`. Resolves once the
   * delegate is ready to accept commands (`goTo`, `applyAppearance`, …).
   */
  mount(host: HTMLElement, ctx: MountContext): Promise<ReaderSession>;

  /**
   * Tear down whatever `mount` set up. Must be idempotent — calling it
   * twice in a row is allowed and a no-op the second time.
   */
  destroy(): Promise<void>;
}

/** Inputs a delegate needs to render content. */
export interface MountContext {
  readonly book: Book;
  readonly appearance: ReaderAppearance;
  readonly loader: BookBytesLoader;
}
