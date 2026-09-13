import type { Book } from "../../core/entities/Book";
import type {
  BookReader,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";

/**
 * Stub adapter for PDF.js. The full PDF session lives in
 * `PdfjsPdfSession.ts`; this adapter only implements the `BookReader`
 * port so the shelf can dispatch on book format uniformly.
 *
 * Real implementation will follow in Phase 1.2.
 */
export class PdfjsBookReader implements BookReader {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async open(book: Book, host: HTMLElement, appearance: ReaderAppearance): Promise<ReaderSession> {
    const view = document.createElement("div");
    view.addClass("ez-reader__pdf-stage");
    host.append(view);
    return new PdfjsSession(view);
  }
}

class PdfjsSession implements ReaderSession {
  readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  async close(): Promise<void> {
    this.element.empty();
    this.element.remove();
  }

  async applyAppearance(_appearance: ReaderAppearance): Promise<void> {
    // PDF appearance is governed by the underlying PdfjsPdfSession which
    // will be wired in once the rendering pipeline is implemented.
  }

  async goTo(_target: ReaderTarget): Promise<void> {
    // Same — placeholder until PdfjsPdfSession lands.
  }

  async currentFraction(): Promise<number> {
    return 0;
  }

  on<K extends keyof ReaderEventMap>(_event: K, _handler: (event: ReaderEventMap[K]) => void): () => void {
    return () => undefined;
  }

  async exportLocator(): Promise<string | null> {
    return null;
  }
}