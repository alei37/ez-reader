import type { AnnotationSnapshot } from "../ports/AnnotationStore";
import type { BookId } from "../entities/Book";

/**
 * Re-key every per-book record in an annotation snapshot from one book id
 * to another.
 *
 * Why this exists
 * ---------------
 * `BookId` is the vault path (`ObsidianBookSource.resolveId` returns
 * `locator.path`). Renaming a book therefore mints a *new* id, and every
 * record keyed by the old one becomes unreachable: reading progress,
 * bookmarks, excerpts, the cover cache, the pin timestamp, the rich
 * metadata and the TOC progress points. The data is not lost — it is still
 * in `data.json` — but the user sees a book they have read for months
 * sitting at 0% with an empty notes file and no highlights.
 *
 * Kept as a pure function (no vault, no Obsidian) so the full rewrite can
 * be tested exhaustively without standing up a store. The adapter wraps it
 * in a single atomic `mutate()`.
 *
 * Collision policy
 * ----------------
 * A rename onto a path that already has records (only reachable if two
 * paths converge, e.g. via Syncthing on two devices) must not silently
 * destroy the destination's state. The pre-existing `toBookId` data wins
 * and the source's data is dropped, for both maps and arrays. Losing the
 * incoming records is the recoverable choice: the user's rename can be
 * undone, whereas the destination's existing progress cannot be
 * reconstructed.
 */

/** Rewrite `.bookId` on every element of a per-book array. */
const rekeyArray = <T extends { readonly bookId: BookId }>(
  items: ReadonlyArray<T>,
  fromBookId: BookId,
  toBookId: BookId
): ReadonlyArray<T> =>
  items.map((item) => (item.bookId === fromBookId ? { ...item, bookId: toBookId } : item));

/**
 * Move one entry of a `*ByBookId` map to a new key, leaving every other
 * entry untouched and never overwriting an existing destination entry.
 */
const rekeyMap = <V>(
  map: Readonly<Record<string, V>> | undefined,
  fromBookId: BookId,
  toBookId: BookId
): Readonly<Record<string, V>> | undefined => {
  // Nothing to move — return the original reference so callers can skip a
  // needless deep rebuild of unrelated state.
  if (!map || !(fromBookId in map)) return map;
  const next: Record<string, V> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === fromBookId) continue;
    next[key] = value;
  }
  if (!(toBookId in map)) {
    next[toBookId] = map[fromBookId] as V;
  }
  return next;
};

/**
 * ReadingState is keyed by bookId in practice (`upsertReading` replaces by
 * id). After a re-key two states can collide, so collapse them — the LAST
 * one wins, matching the store's own last-write-wins upsert.
 */
const dedupeReading = <T extends { readonly bookId: BookId }>(
  states: ReadonlyArray<T>
): ReadonlyArray<T> => {
  const byBookId = new Map<BookId, T>();
  for (const state of states) byBookId.set(state.bookId, state);
  return [...byBookId.values()];
};

export const renameInSnapshot = (
  snapshot: AnnotationSnapshot,
  fromBookId: BookId,
  toBookId: BookId
): AnnotationSnapshot => {
  if (fromBookId === toBookId) return snapshot;

  // `library` preserves insertion order — the shelf's "added" sort depends
  // on it — so this is an in-place substitution, never a re-sort.
  //
  // Collision: if `toBookId` is already in the library, the PRE-EXISTING
  // entry keeps its own position and the renamed book's entry is dropped.
  // This has to walk the original array: mapping first would erase the
  // marker needed to tell the two apart.
  let destinationSeen = snapshot.library.includes(toBookId);
  const library: string[] = [];
  for (const id of snapshot.library) {
    if (id !== fromBookId) {
      library.push(id);
      continue;
    }
    if (destinationSeen) continue;
    destinationSeen = true;
    library.push(toBookId);
  }

  return {
    ...snapshot,
    library,
    reading: dedupeReading(rekeyArray(snapshot.reading, fromBookId, toBookId)),
    bookmarks: rekeyArray(snapshot.bookmarks, fromBookId, toBookId),
    excerpts: rekeyArray(snapshot.excerpts, fromBookId, toBookId),
    coverPaths: rekeyMap(snapshot.coverPaths, fromBookId, toBookId),
    addedAtByBookId: rekeyMap(snapshot.addedAtByBookId, fromBookId, toBookId),
    pinnedAtByBookId: rekeyMap(snapshot.pinnedAtByBookId, fromBookId, toBookId),
    richMetadataByBookId: rekeyMap(snapshot.richMetadataByBookId, fromBookId, toBookId),
    visitedTocIdsByBookId: rekeyMap(snapshot.visitedTocIdsByBookId, fromBookId, toBookId)
  };
};