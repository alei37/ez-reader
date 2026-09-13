import type { Book } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import { mimeTypeFor } from "../../core/entities/Book";

interface FoliateViewElement extends HTMLElement {
  open(book: unknown): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  getCFI(index: number, range?: Range): string;
  addAnnotation(annotation: { value: string }, remove?: boolean): Promise<unknown>;
  deselect(): void;
  book?: {
    toc?: ReadonlyArray<{ label: string; href?: string; subitems?: ReadonlyArray<unknown> }>;
    metadata?: { title?: string; creator?: string | string[]; language?: string | string[] };
    getCover?: () => Promise<Blob | null>;
  };
  lastLocation?: { fraction?: number; cfi?: string; tocItem?: { label?: string } };
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
  getRootNode(): ShadowRoot | Document;
}

interface FoliateModule {
  makeBook: (input: File) => Promise<unknown>;
}

/**
 * Adapter that wraps foliate-js and exposes it through the `BookReader`
 * port. Each `open()` constructs a fresh `<foliate-view>` element; the host
 * is responsible for attaching it to the DOM.
 *
 * Selection is detected on the iframe document that foliate-paginator
 * embeds inside its shadow root. We walk through the shadow boundary to
 * reach the live `contentDocument` and listen for `selectionchange`.
 */
export class FoliateBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const [{ makeBook }] = await Promise.all([import("foliate-js/view.js") as unknown as Promise<FoliateModule>]);

    const bytes = await loader(book.locator.path);
    const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
      type: mimeTypeFor(book.locator.format)
    });
    const parsed = await makeBook(file);

    const view = document.createElement("foliate-view") as FoliateViewElement;
    view.setAttribute("data-ez-reader-flow", appearance.flow);
    host.append(view);
    await view.open(parsed);

    return new FoliateSession(view);
  }

  async extractCover(book: Book, loader: BookBytesLoader): Promise<ExtractedCover | null> {
    const [{ makeBook }] = await Promise.all([import("foliate-js/view.js") as unknown as Promise<FoliateModule>]);
    const bytes = await loader(book.locator.path);
    const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
      type: mimeTypeFor(book.locator.format)
    });
    const parsed = await makeBook(file);
    const bookObj = parsed as { getCover?: () => Promise<Blob | null> };
    if (typeof bookObj.getCover !== "function") return null;
    const blob = await bookObj.getCover();
    if (!blob) return null;
    const coverBytes = await blob.arrayBuffer();
    return { bytes: coverBytes, mimeType: blob.type || "image/jpeg" };
  }
}

class FoliateSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly view: FoliateViewElement;
  private readonly docListeners = new Set<() => void>();

  constructor(view: FoliateViewElement) {
    this.view = view;
    this.element = view;
  }

  async close(): Promise<void> {
    for (const off of this.docListeners) off();
    this.docListeners.clear();
    try {
      this.view.close();
    } catch (error) {
      console.warn("[ez-reader] foliate view.close failed", error);
    }
    try {
      this.view.remove();
    } catch (error) {
      console.warn("[ez-reader] foliate view.remove failed", error);
    }
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    this.view.setAttribute("data-ez-reader-flow", appearance.flow);
  }

  async goTo(target: ReaderTarget): Promise<void> {
    switch (target.kind) {
      case "next":
        await this.view.goRight();
        return;
      case "previous":
        await this.view.goLeft();
        return;
      case "fraction":
        await this.view.goToFraction(target.fraction);
        return;
      case "identifier":
        await this.view.goTo(target.value);
        return;
    }
  }

  async currentFraction(): Promise<number> {
    return this.view.lastLocation?.fraction ?? 0;
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      return this.bindSelectionChange(handler as (event: ReaderEventMap["selection-change"]) => void);
    }
    const wrapped = ((e: Event) => handler(e as ReaderEventMap[K])) as EventListener;
    this.view.addEventListener(event, wrapped);
    return () => this.view.removeEventListener(event, wrapped);
  }

  async exportLocator(): Promise<string | null> {
    return this.view.lastLocation?.cfi ?? null;
  }

  /** Reachable from the UI for the bookmark/excerpt flows. */
  resolveCFI(index: number, range: Range | undefined): string {
    return this.view.getCFI(index, range);
  }

  /** Annotation support (for the excerpt highlight). */
  async addAnnotation(cfi: string): Promise<void> {
    await this.view.addAnnotation({ value: cfi });
  }

  async removeAnnotation(cfi: string): Promise<void> {
    await this.view.addAnnotation({ value: cfi }, true);
  }

  clearSelection(): void {
    this.view.deselect();
  }

  /** Book metadata resolved after `view.open()`. */
  describe(): {
    title?: string;
    authors?: string[];
    languages?: string[];
    toc?: ReadonlyArray<{ label: string; href?: string; subitems?: ReadonlyArray<unknown> }>;
    chapter?: string;
  } {
    const meta = this.view.book?.metadata;
    return {
      title: meta?.title,
      authors: meta?.creator ? (Array.isArray(meta.creator) ? meta.creator : [meta.creator]) : undefined,
      languages: meta?.language ? (Array.isArray(meta.language) ? meta.language : [meta.language]) : undefined,
      toc: this.view.book?.toc,
      chapter: this.view.lastLocation?.tocItem?.label
    };
  }

  /**
   * foliate-paginator embeds the actual book document inside a shadow root.
   * We descend into that shadow to reach the live iframe.contentDocument and
   * listen for selectionchange; on every selection we package the text and
   * a coarse CFI locator.
   */
  private bindSelectionChange(handler: (event: ReaderEventMap["selection-change"]) => void): () => void {
    const off = () => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
    };

    const tryAttach = (): boolean => {
      const shadow = this.view.getRootNode();
      if (!(shadow instanceof ShadowRoot)) return false;
      const iframe = shadow.querySelector("iframe");
      const doc = iframe?.contentDocument;
      if (!doc) return false;

      const onChange = () => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text) return;
        handler({ text, locator: this.view.lastLocation?.cfi } as unknown as ReaderEventMap["selection-change"]);
      };
      doc.addEventListener("selectionchange", onChange);
      this.docListeners.add(() => doc.removeEventListener("selectionchange", onChange));
      return true;
    };

    if (!tryAttach()) {
      // foliate-paginator loads the iframe lazily; retry on the next load event.
      const wrapped = () => {
        if (tryAttach()) this.view.removeEventListener("load", wrapped);
      };
      this.view.addEventListener("load", wrapped);
      this.docListeners.add(() => this.view.removeEventListener("load", wrapped));
    }

    return off;
  }
}