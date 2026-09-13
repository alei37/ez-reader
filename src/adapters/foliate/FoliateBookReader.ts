import type { Book } from "../../core/entities/Book";
import type {
  BookReader,
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
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}

interface FoliateModule {
  makeBook: (input: File) => Promise<unknown>;
}

/**
 * Adapter that wraps `foliate-js` and exposes it through the core
 * `BookReader` port. Each `open()` call constructs a fresh view element;
 * the host owns attaching it to the DOM.
 */
export class FoliateBookReader implements BookReader {
  async open(book: Book, host: HTMLElement, appearance: ReaderAppearance): Promise<ReaderSession> {
    const [{ makeBook }, { Overlayer }] = await Promise.all([
      import("foliate-js/view.js") as unknown as Promise<FoliateModule>,
      import("foliate-js/overlayer.js") as unknown as Promise<{ Overlayer: unknown }>
    ]);

    const response = await fetch(book.locator.path);
    const bytes = await response.arrayBuffer();
    const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
      type: mimeTypeFor(book.locator.format)
    });
    const parsed = await makeBook(file);
    const view = document.createElement("foliate-view") as FoliateViewElement;
    view.setAttribute("data-ez-reader-flow", appearance.flow);
    host.append(view);
    await view.open(parsed);

    return new FoliateSession(view, Overlayer, appearance);
  }
}

class FoliateSession implements ReaderSession {
  readonly element: HTMLElement;

  constructor(
    private readonly view: FoliateViewElement,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly Overlayer: unknown,
    private appearance: ReaderAppearance
  ) {
    this.element = view;
  }

  async close(): Promise<void> {
    this.view.close();
    this.view.remove();
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    this.appearance = appearance;
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
        // foliate-js does not expose a public fraction API; we use a no-op
        // stub so the contract is in place. Future work can resolve it.
        return;
      case "identifier":
        await this.view.goTo(target.value);
        return;
    }
  }

  async currentFraction(): Promise<number> {
    return 0;
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    const wrapped = ((e: Event) => handler(e as ReaderEventMap[K])) as EventListener;
    this.view.addEventListener(event, wrapped);
    return () => this.view.removeEventListener(event, wrapped);
  }

  async exportLocator(): Promise<string | null> {
    return null;
  }
}