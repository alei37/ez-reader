import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";

export interface ShelfItemHandlers {
  onOpen: (entry: LibraryEntry) => void;
  onContextMenu: (entry: LibraryEntry, event: MouseEvent) => void;
}

export const renderGridItem = (entry: LibraryEntry, handlers: ShelfItemHandlers, coverResourcePath?: string): HTMLElement => {
  const card = document.createElement("div");
  card.addClass("ez-reader__shelf-grid__item");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.title = entry.book.metadata?.title ?? entry.book.locator.path;

  const cover = card.createDiv({ cls: "ez-reader__shelf-grid__cover" });
  if (coverResourcePath) {
    const img = cover.createEl("img", {
      attr: { src: coverResourcePath, alt: entry.book.metadata?.title ?? "" }
    });
    img.addEventListener("error", () => img.remove());
  } else {
    cover.addClass("is-placeholder");
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
    cover.createEl("span", {
      text: title.charAt(0).toLocaleUpperCase(),
      cls: "ez-reader__shelf-grid__cover-glyph"
    });
    cover.createEl("span", {
      text: title,
      cls: "ez-reader__shelf-grid__cover-title"
    });
  }

  const meta = card.createDiv({ cls: "ez-reader__shelf-grid__meta" });
  const titleText = entry.book.metadata?.title ?? entry.book.locator.path;
  const titleEl = meta.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-grid__title"
  });
  titleEl.setAttribute("title", titleText);
  titleEl.addEventListener("contextmenu", (event) => event.preventDefault());
  meta.createEl("span", {
    text: entry.book.metadata?.authors[0] ?? extractAuthorFallback(entry.book.locator.path),
    cls: "ez-reader__shelf-grid__author"
  });

  const footer = card.createDiv({ cls: "ez-reader__shelf-grid__footer" });
  footer.createEl("span", { text: statusLabel(entry.reading.status), cls: `ez-reader__status-pill is-${entry.reading.status}` });
  const fraction = progressFraction(entry.reading);
  if (fraction > 0) {
    footer.createEl("span", { text: `${Math.round(fraction * 100)}%`, cls: "ez-reader__shelf-grid__progress" });
  }
  if (entry.reading.favorite) {
    footer.createEl("span", { text: "★", cls: "ez-reader__shelf-grid__favorite" });
  }

  card.addEventListener("click", () => handlers.onOpen(entry));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.onOpen(entry);
    }
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.onContextMenu(entry, event);
  });
  return card;
};

const statusLabel = (status: string): string => {
  switch (status) {
    case "reading":
      return "在读";
    case "finished":
      return "已读完";
    case "abandoned":
      return "暂弃";
    default:
      return "未开始";
  }
};

/**
 * Best-effort author guess from the path when we haven't parsed metadata
 * yet (covers PDF files we haven't opened). Falls back to the parent
 * directory name so the card shows something more useful than "未知作者".
 */
const extractAuthorFallback = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, -1).join(" / ");
  return "未知作者";
};