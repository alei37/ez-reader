import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";

export interface ShelfListHandlers {
  onOpen: (entry: LibraryEntry) => void;
  onContextMenu: (entry: LibraryEntry, event: MouseEvent) => void;
}

export const renderListItem = (entry: LibraryEntry, handlers: ShelfListHandlers, coverResourcePath?: string): HTMLElement => {
  const row = document.createElement("div");
  row.addClass("ez-reader__shelf-list__item");
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");

  if (coverResourcePath) {
    const cover = row.createEl("img", {
      attr: { src: coverResourcePath, alt: "" },
      cls: "ez-reader__shelf-list__cover"
    });
    cover.addEventListener("error", () => cover.remove());
  } else {
    const cover = row.createDiv({ cls: "ez-reader__shelf-list__cover is-placeholder" });
    cover.setText((entry.book.metadata?.title ?? entry.book.locator.path).charAt(0));
  }

  const info = row.createDiv({ cls: "ez-reader__shelf-list__info" });
  info.createEl("span", {
    text: entry.book.metadata?.title ?? entry.book.locator.path,
    cls: "ez-reader__shelf-list__title"
  });
  info.createEl("span", {
    text: entry.book.metadata?.authors.join("、") || extractAuthorFallback(entry.book.locator.path),
    cls: "ez-reader__shelf-list__author"
  });

  const fraction = progressFraction(entry.reading);
  row.createEl("span", {
    text: fraction > 0 ? `${Math.round(fraction * 100)}%` : "—",
    cls: "ez-reader__shelf-list__progress"
  });
  row.createEl("span", {
    text: statusLabel(entry.reading.status),
    cls: `ez-reader__status-pill is-${entry.reading.status}`
  });

  row.addEventListener("click", () => handlers.onOpen(entry));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.onOpen(entry);
    }
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.onContextMenu(entry, event);
  });
  return row;
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

const extractAuthorFallback = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, -1).join(" / ");
  return "未知作者";
};