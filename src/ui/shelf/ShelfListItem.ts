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
    cover.addEventListener("error", () => {
      cover.remove();
      const placeholder = row.createDiv({ cls: "ez-reader__shelf-list__cover is-placeholder" });
      placeholder.setText((entry.book.metadata?.title ?? entry.book.locator.path).charAt(0));
    });
  } else {
    const cover = row.createDiv({ cls: "ez-reader__shelf-list__cover is-placeholder" });
    cover.setText((entry.book.metadata?.title ?? entry.book.locator.path).charAt(0));
  }

  const info = row.createDiv({ cls: "ez-reader__shelf-list__info" });
  const titleText = entry.book.metadata?.title ?? entry.book.locator.path;
  info.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-list__title"
  });
  info.createEl("span", {
    text: entry.book.metadata?.authors.join("、") || extractAuthorFallback(entry.book.locator.path),
    cls: "ez-reader__shelf-list__author"
  });
  // Hover tooltip 同样给出路径信息, 帮用户识别未解析 metadata 的书
  const tip = [titleText];
  if (entry.book.metadata?.publisher) tip.push(entry.book.metadata.publisher);
  if (entry.book.metadata?.published) tip.push(entry.book.metadata.published);
  tip.push(entry.book.locator.path);
  row.setAttribute("title", tip.join(" · "));

  const fraction = progressFraction(entry.reading);
  let progressText = "—";
  if (entry.reading.position?.kind === "pdf") {
    progressText = `第 ${entry.reading.position.page} 页`;
  } else if (fraction > 0) {
    progressText = `${Math.round(fraction * 100)}%`;
  }
  row.createEl("span", {
    text: progressText,
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