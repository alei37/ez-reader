import type { LibraryEntry } from "../../core/services/LibraryService";
import { progressFraction } from "../../core/entities/ReadingState";
import { extractAuthorFallback, statusLabel } from "./shelfFormatters";

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
    cover.setCssStyles(placeholderBackground(title));
    cover.createEl("span", {
      text: title.charAt(0).toLocaleUpperCase(),
      cls: "ez-reader__shelf-grid__cover-glyph"
    });
    cover.createEl("span", {
      text: title,
      cls: "ez-reader__shelf-grid__cover-title"
    });
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

/**
 * Generate a stable, deterministic gradient for the placeholder cover.
 * Two books with similar titles will have similar hues, but each book
 * still gets its own background — no two covers look identical.
 *
 * Cached so we don't recompute the hash for the same title on every
 * re-render. The map is bounded to a few hundred entries to keep
 * memory tight when the user has thousands of books.
 */
const placeholderCache = new Map<string, Record<string, string>>();
const PLACEHOLDER_CACHE_MAX = 500;

const placeholderBackground = (title: string): Record<string, string> => {
  const cached = placeholderCache.get(title);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash = hash & hash;
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 28) % 360;
  const result = {
    background: `linear-gradient(135deg, hsl(${hue1}, 38%, 28%), hsl(${hue2}, 48%, 18%))`,
    color: "rgba(255, 255, 255, 0.92)"
  };
  if (placeholderCache.size >= PLACEHOLDER_CACHE_MAX) {
    // 简单 FIFO: 删除最早插入
    const firstKey = placeholderCache.keys().next().value;
    if (firstKey !== undefined) placeholderCache.delete(firstKey);
  }
  placeholderCache.set(title, result);
  return result;
};