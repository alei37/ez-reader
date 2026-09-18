/**
 * PDF 高亮回显的纯函数 — 把保存的 excerpt 文本在当前 PDFView 的
 * text-layer 里找出来, 返回屏幕坐标的矩形数组 (跨多行选区时返回多个)。
 *
 * 算法:
 * 1. 找到对应 page 元素 (.page[data-page-number="N"])
 * 2. 走它的 text-layer 直接子 spans, 拼接它们的 textContent
 * 3. 在拼接字符串里找 excerpt.text (允许部分匹配 — 取前 30 字符作为 anchor)
 * 4. 用 anchor 起始 / 整段结束两个 offset, 走 spans 拿到 start / end span
 *    的 getBoundingClientRect, 中间所有 span 都返回矩形 (跨行时多 rect).
 *
 * 为什么用 text 匹配而不是存 subpath 坐标?
 * - 屏幕坐标随 zoom / scroll 改变, 存了也不能复用
 * - PDF++ 也是用这种 text-anchor 方案做 backlink 高亮
 * - PDFView 的 pdfjs text-layer 是按 word 切 span, 字符位置可计算
 *
 * 限制:
 * - 不支持跨页选区
 * - 同页重复文本只高亮第一个匹配
 */

const ANCHOR_PREFIX_LEN = 30;

export interface PageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FindTextResult {
  readonly pageNumber: number;
  readonly rects: ReadonlyArray<PageRect>;
}

const findPageElement = (container: HTMLElement, pageNumber: number): HTMLElement | null => {
  const selector = `.pdf-page[data-page-number="${pageNumber}"], .page[data-page-number="${pageNumber}"]`;
  return container.querySelector(selector);
};

/**
 * Direct-child spans inside `.textLayer`. Using `> span` (not
 * `querySelectorAll("span")`) avoids double-counting chars if a user CSS
 * rule ever injects nested spans — the previous loose selector counted
 * descendant spans twice and threw the char offsets off.
 */
const collectTextLayerSpans = (pageEl: HTMLElement): HTMLElement[] => {
  const textLayer = pageEl.querySelector(".textLayer");
  if (!(textLayer instanceof HTMLElement)) return [];
  return Array.from(textLayer.querySelectorAll(":scope > span")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
};

/**
 * Returns the rect of every span that contributes characters in the
 * half-open range `[start, end)`. If start and end fall inside the same
 * span the array has one entry. For multi-line / multi-word selections
 * each touched word becomes a separate rect.
 */
const rectsInRange = (
  spans: ReadonlyArray<HTMLElement>,
  start: number,
  end: number
): PageRect[] => {
  const out: PageRect[] = [];
  let acc = 0;
  for (const span of spans) {
    const len = (span.textContent ?? "").length;
    if (len === 0) continue;
    const spanStart = acc;
    const spanEnd = acc + len;
    if (spanEnd > start && spanStart < end) {
      const r = span.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
    }
    acc = spanEnd;
    if (acc >= end) break;
  }
  return out;
};

/**
 * 在指定 page 元素里搜索 searchText, 返回所有匹配 span 的屏幕坐标矩形.
 * 跨行 / 跨 word 选区返回多个 rect.
 */
export const findTextOnPage = (pageEl: HTMLElement, searchText: string): PageRect[] => {
  if (!searchText) return [];
  const spans = collectTextLayerSpans(pageEl);
  if (spans.length === 0) return [];
  const spanTexts = spans.map((s) => s.textContent ?? "");
  const fullText = spanTexts.join("");
  const anchor = searchText.slice(0, ANCHOR_PREFIX_LEN);
  const idx = fullText.indexOf(anchor);
  if (idx < 0) return [];
  // 尝试用完整 searchText 长度截取; 如果超出 text-layer 长度就用 anchor 长度.
  const length = Math.min(searchText.length, fullText.length - idx);
  if (length <= 0) return [];
  return rectsInRange(spans, idx, idx + length);
};

/**
 * 给定 PDF 容器 + 想要高亮的页码 + 文本, 返回屏幕坐标矩形数组 (找不到则 null).
 * 顶层便利函数 — 包含 findPageElement 步骤.
 */
export const findHighlightRect = (
  container: HTMLElement,
  pageNumber: number,
  searchText: string
): FindTextResult | null => {
  const pageEl = findPageElement(container, pageNumber);
  if (!pageEl) return null;
  const rects = findTextOnPage(pageEl, searchText);
  if (rects.length === 0) return null;
  return { pageNumber, rects };
};

/**
 * Find the next page (after `fromPage`) that contains `searchText` in its
 * text-layer. Returns the page number (1-based) or null when no match is
 * found across all visible pages. Capped at `maxPages` to keep the scan
 * bounded for huge PDFs — the caller can re-call to keep searching if the
 * user opts to "wrap around".
 *
 * Used by the in-PDF search bar to advance between matches when the user
 * presses Enter / clicks ↓.
 */
export const findNextPageWithText = (
  container: HTMLElement,
  searchText: string,
  fromPage: number,
  options: { maxPages?: number; caseSensitive?: boolean } = {}
): number | null => {
  if (!searchText.trim()) return null;
  const maxPages = options.maxPages ?? 200;
  const caseSensitive = options.caseSensitive === true;
  const needle = caseSensitive ? searchText : searchText.toLocaleLowerCase();
  const allPages = Array.from(
    container.querySelectorAll<HTMLElement>(".pdf-page[data-page-number], .page[data-page-number]")
  );
  if (allPages.length === 0) return null;
  // Sort by data-page-number so callers can rely on deterministic order.
  const pages = allPages
    .map((el) => Number(el.getAttribute("data-page-number") ?? "0"))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (pages.length === 0) return null;
  // Start searching from `fromPage` (1-based); wrap around if not found.
  const startIdx = pages.findIndex((p) => p >= fromPage);
  const order = startIdx >= 0
    ? [...pages.slice(startIdx), ...pages.slice(0, startIdx)]
    : pages;
  let scanned = 0;
  for (const pageNum of order) {
    if (scanned >= maxPages) break;
    scanned += 1;
    const pageEl = findPageElement(container, pageNum);
    if (!pageEl) continue;
    const text = collectTextLayerSpans(pageEl).map((s) => s.textContent ?? "").join("");
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    if (haystack.includes(needle)) return pageNum;
  }
  return null;
};