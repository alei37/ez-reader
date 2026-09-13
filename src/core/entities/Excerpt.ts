import type { BookId } from "./Book";
import type { ReadingPosition } from "./ReadingState";

export type ExcerptId = string;

export interface ExcerptLocator {
  readonly position: ReadingPosition;
  readonly chapter?: string;
}

/**
 * A user-saved snippet from a book. Text is stored verbatim, locator enough
 * to return to the same position even after format conversion.
 */
export interface Excerpt {
  readonly id: ExcerptId;
  readonly bookId: BookId;
  readonly text: string;
  readonly locator: ExcerptLocator;
  readonly note: string;
  readonly tags: ReadonlyArray<string>;
  readonly createdAt: number;
}