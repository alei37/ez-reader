import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";
import { extractAuthorFallback, statusLabel } from "./shelfFormatters";

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
  const authorText = (entry.book.metadata?.authors ?? []).join("、") || extractAuthorFallback(entry.book.locator.path);
  const fraction = progressFraction(entry.reading);
  let progressText = "—";
  let progressFractionValue = 0;
  if (entry.reading.position?.kind === "pdf") {
    progressText = `第 ${entry.reading.position.page} 页`;
    // PDF 没分母 — 不画 bar (避免 bar 显示成 100% 让用户误以为读完了)
  } else if (fraction > 0) {
    progressText = `${Math.round(fraction * 100)}%`;
    progressFractionValue = fraction;
  }
  info.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-list__title"
  });
  info.createEl("span", {
    text: authorText,
    cls: "ez-reader__shelf-list__author"
  });
  // 进度条 (EPUB 等可计算 fraction 的格式). PDF 没分母所以不画 —
  // 画了反而误导用户以为读到 30% 而其实是 30/200 页.
  if (progressFractionValue > 0) {
    const bar = info.createDiv({ cls: "ez-reader__shelf-list__bar" });
    const fill = bar.createDiv({ cls: "ez-reader__shelf-list__bar-fill" });
    fill.style.width = `${Math.min(100, Math.round(progressFractionValue * 100))}%`;
  }
  // Hover tooltip 同样给出路径信息, 帮用户识别未解析 metadata 的书
  const tip = [titleText];
  if (entry.book.metadata?.publisher) tip.push(entry.book.metadata.publisher);
  if (entry.book.metadata?.published) tip.push(entry.book.metadata.published);
  tip.push(entry.book.locator.path);
  row.setAttribute("title", tip.join(" · "));
  // aria-label 让屏幕阅读器读出完整信息 (hover tooltip 用 title, screen reader 用 aria-label)
  row.setAttribute("aria-label", `${titleText} · ${authorText} · ${progressText} · ${statusLabel(entry.reading.status)}`);
  row.createEl("span", {
    text: progressText,
    cls: "ez-reader__shelf-list__progress"
  });
  row.createEl("span", {
    text: statusLabel(entry.reading.status),
    cls: `ez-reader__status-pill is-${entry.reading.status}`
  });
  // 与 ShelfGridItem 保持一致: 平台标签 + 语种 + favorite ★
  row.createEl("span", {
    text: entry.book.locator.format.toUpperCase(),
    cls: "ez-reader__shelf-list__format"
  });
  const lang = entry.book.metadata?.languages?.[0];
  if (lang) {
    row.createEl("span", { text: lang, cls: "ez-reader__shelf-list__lang" });
  }
  if (entry.reading.favorite) {
    row.createEl("span", { text: "★", cls: "ez-reader__shelf-list__favorite", title: "已收藏" });
  }
  // P1 新功能: 列表视图也显示置顶 — 放最前, 跟 grid 的📌保持一致.
  if (entry.book.pinnedAt !== null) {
    row.createEl("span", { text: "📌", cls: "ez-reader__shelf-list__pin", title: "已置顶 — 右键菜单可取消" });
  }

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