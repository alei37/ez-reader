import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";

export interface ShelfItemHandlers {
  onOpen: (entry: LibraryEntry) => void;
  onContextMenu: (entry: LibraryEntry, event: MouseEvent) => void;
}

export const renderGridItem = (entry: LibraryEntry, handlers: ShelfItemHandlers, coverResourcePath?: string): HTMLElement => {
  const card = document.createElement("button");
  card.addClass("ez-reader__shelf-grid__item");
  card.type = "button";
  card.title = entry.book.metadata?.title ?? entry.book.locator.path;

  const cover = card.createDiv({ cls: "ez-reader__shelf-grid__cover" });
  if (coverResourcePath) {
    const img = cover.createEl("img", {
      attr: { src: coverResourcePath, alt: entry.book.metadata?.title ?? "" }
    });
    img.addEventListener("error", () => img.remove());
  } else {
    cover.addClass("is-placeholder");
    cover.setText(entry.book.metadata?.title ?? entry.book.locator.path);
  }

  const meta = card.createDiv({ cls: "ez-reader__shelf-grid__meta" });
  meta.createEl("span", {
    text: entry.book.metadata?.title ?? entry.book.locator.path,
    cls: "ez-reader__shelf-grid__title"
  });
  meta.createEl("span", {
    text: entry.book.metadata?.authors[0] ?? "未知作者",
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