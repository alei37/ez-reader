import type { Book } from "../entities/Book";
import type { ReaderAppearance, ReaderOpenMode } from "../types/ReaderSettings";

/** Where the reader should jump to next. Format-specific. */
export type ReaderTarget =
  | { readonly kind: "fraction"; readonly fraction: number }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "identifier"; readonly value: string };

export interface ReaderEventMap {
  relocate: CustomEvent<{ fraction?: number; locator?: string; chapter?: string; page?: number }>;
  "selection-change": CustomEvent<{ text: string; locator?: string; rect?: DOMRect }>;
  close: Event;
}

export interface ReaderSession {
  /** Element that holds the rendered book. Plug into a leaf to display. */
  readonly element: HTMLElement;

  /** Tear down the session and free any workers/iframes. */
  close(): Promise<void>;

  /** Apply a reader appearance change without recreating the session. */
  applyAppearance(appearance: ReaderAppearance): Promise<void>;

  /** Move within the book. */
  goTo(target: ReaderTarget): Promise<void>;

  /** Returns the current position as a fraction in [0, 1]. */
  currentFraction(): Promise<number>;

  /** Add an event listener; returns a disposer. */
  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void;

  /** Returns a locator string the host can persist to resume later. */
  exportLocator(): Promise<string | null>;

  /**
   * Optional zoom controls. Implementations that don't support a zoom
   * dimension (e.g. reflowable engines) can leave these as no-ops; the
   * toolbar will hide the controls when the handlers aren't supplied.
   */
  setScale?(scale: number): Promise<void>;
  setFitWidth?(): Promise<void>;
  currentScale?(): number;
  isFitWidth?(): boolean;

  // ---- 新增能力 ----

  /**
   * 当前页码(若适用)。EPUB 返回当前 section index,PDF 返回 page number。
   * 文本 / 资源类书籍返回 null。
   */
  currentPage?(): number | null;
  /** 总页数(若适用)。 */
  totalPages?(): number | null;

  /**
   * 章节列表(TOC)。返回扁平的 {id, label, depth, locator} 数组,
   * depth 表示层级缩进。
   */
  tableOfContents?(): Promise<ReadonlyArray<TocItem>>;

  /**
   * 跳转到指定章节 id(从 tableOfContents 返回的 id)。
   */
  goToToc?(id: string): Promise<void>;

  /**
   * 选中后,在选区上加 highlight。cfi/rect 是定位信息(由 selection 事件提供)。
   * rect 用 page-relative 坐标存,便于后续渲染稳定。
   */
  highlight?(selection: HighlightSpec): Promise<void>;

  /** 移除指定 id 的高亮。 */
  removeHighlight?(id: string): Promise<void>;

  /** 列出当前 session 已加的 highlights。 */
  listHighlights?(): ReadonlyArray<HighlightSpec>;

  /**
   * 触发翻页动画或同步翻页。platform 为 'desktop' / 'tablet',
   * 用以决定用键盘/点击/手势。
   */
  next?(): Promise<void>;
  previous?(): Promise<void>;

  /** 当前章节标题(若适用)。 */
  currentChapter?(): string | null;
}

export interface TocItem {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
  /** 直接定位用的 locator (cfi / page number / fraction) */
  readonly locator?: string;
}

export interface HighlightSpec {
  readonly id: string;
  /** 选中的文本内容 */
  readonly text: string;
  /** 引擎特定定位 (cfi / page) */
  readonly locator: string;
  /** PDF 专用: page-relative 矩形列表 */
  readonly rects?: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
  /** 笔记 / 想法 */
  readonly note?: string;
  /** 颜色 / 标记类型 (yellow / red / blue / green) */
  readonly color?: HighlightColor;
  /** 创建时间 */
  readonly createdAt: number;
}

export type HighlightColor = "yellow" | "red" | "blue" | "green";

/**
 * Loads the raw bytes for a given Vault-relative path. Book adapters cannot
 * use `fetch()` directly because Obsidian's `obsidian://` resources are not
 * reachable from the renderer. Concrete adapters get a loader injected so
 * they stay portable while still being able to read the file contents.
 */
export type BookBytesLoader = (path: string) => Promise<ArrayBuffer>;

/**
 * A book cover extracted from the source file. `bytes` is the raw image
 * data; the host (plugin) is responsible for writing it to disk and
 * surfacing an `app://` resource URL for the renderer to consume.
 */
export interface ExtractedCover {
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
}

/**
 * Adapter interface for a reader engine. The core layer depends only on this;
 * implementations wrap foliate-js, PDF.js, or any future engine.
 */
export interface BookReader {
  /** Open a book and return a session bound to the given host element. */
  open(book: Book, host: HTMLElement, appearance: ReaderAppearance, loader: BookBytesLoader): Promise<ReaderSession>;

  /**
   * Extract the book's cover image (if any) without rendering it. Returns
   * null when the format has no embedded cover (e.g. plain TXT) or when
   * extraction fails; the host can then fall back to a generated cover.
   */
  extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null>;
}

/** Helper to resolve how a reader should be displayed inside a leaf. */
export interface ReaderHost {
  open(mode: ReaderOpenMode): Promise<{ host: HTMLElement; dispose: () => Promise<void> }>;
}