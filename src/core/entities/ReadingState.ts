import type { BookId } from "./Book";

/** Where the user left off, format-dependent. */
export type ReadingPosition =
  | { readonly kind: "reflow"; readonly fraction: number; readonly cfi?: string }
  | { readonly kind: "text"; readonly fraction: number; readonly start: number; readonly end: number }
  | { readonly kind: "pdf"; readonly page: number; readonly scale?: number; readonly fitWidth?: boolean };

/** User-tagged shelf state, similar to Goodreads shelves. */
export type ReadingStatus = "unread" | "reading" | "finished" | "abandoned";

export const READING_STATUSES: ReadonlyArray<ReadingStatus> = [
  "unread",
  "reading",
  "finished",
  "abandoned"
];

export interface ReadingState {
  readonly bookId: BookId;
  readonly position: ReadingPosition | null;
  readonly status: ReadingStatus;
  readonly favorite: boolean;
  readonly lastOpenedAt: number | null;
  /** Sum of milliseconds the reader has been the active leaf for. */
  readonly totalReadingMs: number;
}

export const defaultReadingState = (bookId: BookId, now = Date.now()): ReadingState => ({
  bookId,
  position: null,
  status: "unread",
  favorite: false,
  lastOpenedAt: null,
  totalReadingMs: 0
});

export const progressFraction = (state: ReadingState): number => {
  if (!state.position) return 0;
  switch (state.position.kind) {
    case "reflow":
      return clamp(state.position.fraction);
    case "text":
      return clamp(state.position.fraction);
    case "pdf":
      // PDF page alone is not enough for a fraction without page count; the
      // adapter resolves this before handing it back to us. The default is
      // 0 so unconfigured PDFs sort as "untouched".
      return 0;
  }
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));