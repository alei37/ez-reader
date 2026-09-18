import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";
import { extractAuthorFallback, statusLabel } from "./shelfFormatters";
import { placeholderCoverStyle } from "./placeholderCover";

export interface ShelfItemHandlers {
  onOpen: (entry: LibraryEntry) => void;
  onContextMenu: (entry: LibraryEntry, event: MouseEvent) => void;
}

export const renderGridItem = (entry: LibraryEntry, handlers: ShelfItemHandlers, coverResourcePath?: string): HTMLElement => {
  const card = document.createElement("div");
  card.addClass("ez-reader__shelf-grid__item");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  // title 用 hover tooltip, aria-label 用 screen reader — 两者都需要
  const titleText = entry.book.metadata?.title ?? entry.book.locator.path;
  card.title = titleText;
  const authorText = entry.book.metadata?.authors?.[0] ?? extractAuthorFallback(entry.book.locator.path);
  const fraction = progressFraction(entry.reading);
  let progressText = "—";
  if (entry.reading.position?.kind === "pdf") {
    progressText = `第 ${entry.reading.position.page} 页`;
  } else if (fraction > 0) {
    progressText = `${Math.round(fraction * 100)}%`;
  }
  card.setAttribute("aria-label", `${titleText} · ${authorText} · ${progressText} · ${statusLabel(entry.reading.status)}`);

  const cover = card.createDiv({ cls: "ez-reader__shelf-grid__cover" });
  if (coverResourcePath) {
    cover.addClass("has-image");
    const img = cover.createEl("img", {
      attr: { src: coverResourcePath, alt: entry.book.metadata?.title ?? "" },
      cls: "ez-reader__shelf-grid__cover-image"
    });
    img.addEventListener("error", () => {
      img.remove();
      cover.removeClass("has-image");
      cover.addClass("is-placeholder");
    });
  } else {
    cover.addClass("is-placeholder");
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
    const style = placeholderCoverStyle(title);
    cover.setCssStyles({ background: style.background, color: style.color });
    cover.createEl("span", {
      text: title.charAt(0).toLocaleUpperCase(),
      cls: "ez-reader__shelf-grid__cover-glyph",
      attr: { style: `text-shadow: ${style.textShadow}` }
    });
    const titleEl = cover.createEl("span", {
      text: title,
      cls: "ez-reader__shelf-grid__cover-title"
    });
    titleEl.style.textShadow = style.textShadow;
  }
  // P1 新功能: 置顶标记 — 在封面右上角放一个小 📌 icon, 不遮挡封面内容.
  // 用 lucide `pin` 图标, setIcon 由 caller (ShelfView) 在 toolbar 入口
  // 注入 setIcon; 这里直接画 fallback 字符 (Obsidian 在 1.5+ 内置
  // lucide, 但为了兼容先 unicode 字符, 后续可以替换成 SVG).
  if (entry.book.pinnedAt !== null) {
    const pin = cover.createDiv({ cls: "ez-reader__shelf-grid__pin", attr: { title: "已置顶 — 在右键菜单中可取消", "aria-label": "已置顶" }, text: "📌" });
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onContextMenu(entry, event as MouseEvent);
    });
  }

  const meta = card.createDiv({ cls: "ez-reader__shelf-grid__meta" });
  const titleEl = meta.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-grid__title"
  });
  // Hover tooltip: 标题 + 作者 + 出版 + 路径(在 metadata 缺失时帮助识别)
  const tooltipParts = [titleText];
  if (entry.book.metadata?.publisher) tooltipParts.push(entry.book.metadata.publisher);
  if (entry.book.metadata?.published) tooltipParts.push(entry.book.metadata.published);
  tooltipParts.push(entry.book.locator.path);
  card.setAttribute("title", tooltipParts.join(" · "));
  titleEl.setAttribute("title", titleText);
  titleEl.addEventListener("contextmenu", (event) => event.preventDefault());
  meta.createEl("span", {
    text: authorText,
    cls: "ez-reader__shelf-grid__author"
  });

  const footer = card.createDiv({ cls: "ez-reader__shelf-grid__footer" });
  footer.createEl("span", { text: statusLabel(entry.reading.status), cls: `ez-reader__status-pill is-${entry.reading.status}` });
  // PDF 没有 fraction, 用 page number 替代
  if (entry.reading.position?.kind === "pdf") {
    const page = entry.reading.position.page;
    footer.createEl("span", { text: `第 ${page} 页`, cls: "ez-reader__shelf-grid__progress" });
  } else if (fraction > 0) {
    footer.createEl("span", { text: `${Math.round(fraction * 100)}%`, cls: "ez-reader__shelf-grid__progress" });
  }
  // 平台标签: EPUB / PDF 等
  footer.createEl("span", {
    text: entry.book.locator.format.toUpperCase(),
    cls: "ez-reader__shelf-grid__format"
  });
  if (entry.reading.favorite) {
    footer.createEl("span", { text: "★", cls: "ez-reader__shelf-grid__favorite" });
  }
  // 显示语种(只显示第一个)
  const lang = entry.book.metadata?.languages?.[0];
  if (lang) {
    footer.createEl("span", { text: lang, cls: "ez-reader__shelf-grid__lang" });
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