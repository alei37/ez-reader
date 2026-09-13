import type { Book } from "../entities/Book";
import type { ReaderAppearance, ReaderOpenMode } from "../types/ReaderSettings";

/** Where the reader should jump to next. Format-specific. */
export type ReaderTarget =
  | { readonly kind: "fraction"; readonly fraction: number }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "identifier"; readonly value: string };

export interface ReaderEventMap {
  relocate: CustomEvent<{ fraction?: number; locator?: string }>;
  "selection-change": CustomEvent<{ text: string; locator?: string }>;
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
}

/**
 * Loads the raw bytes for a given Vault-relative path. Book adapters cannot
 * use `fetch()` directly because Obsidian's `obsidian://` resources are not
 * reachable from the renderer. Concrete adapters get a loader injected so
 * they stay portable while still being able to read the file contents.
 */
export type BookBytesLoader = (path: string) => Promise<ArrayBuffer>;

/**
 * Adapter interface for a reader engine. The core layer depends only on this;
 * implementations wrap foliate-js, PDF.js, or any future engine.
 */
export interface BookReader {
  /** Open a book and return a session bound to the given host element. */
  open(book: Book, host: HTMLElement, appearance: ReaderAppearance, loader: BookBytesLoader): Promise<ReaderSession>;
}

/** Helper to resolve how a reader should be displayed inside a leaf. */
export interface ReaderHost {
  open(mode: ReaderOpenMode): Promise<{ host: HTMLElement; dispose: () => Promise<void> }>;
}