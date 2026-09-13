import type { BookId } from "./Book";
import type { ReadingPosition } from "./ReadingState";

export type BookmarkId = string;

export interface BookmarkLocator {
  readonly position: ReadingPosition;
  readonly chapter?: string;
}

export interface Bookmark {
  readonly id: BookmarkId;
  readonly bookId: BookId;
  readonly locator: BookmarkLocator;
  readonly label: string;
  readonly createdAt: number;
}