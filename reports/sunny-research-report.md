# SunnyD0697/local-book-reader 调研报告（v0.3.6 main 分支）

调研对象:https://github.com/SunnyD0697/local-book-reader （commit `507e9a8` 之前,2025-03 状态）
项目定位:**桌面 only** 的 Obsidian 插件,支持 EPUB/MOBI/AZW/PDF/TXT,自带个人书库 + Markdown 笔记 + 主题研究笔记。
调研目的:把核心阅读器能力(目录/划词/CFI/字号行距边距/翻页/笔记/双链)借鉴到我们 ez-reader 的分层架构里。

---

## 一、架构图(SunnyD0697 → ez-reader 对照)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Plugin Lifecycle (main.ts)                                              │
│   - registerObsidianProtocolHandler("local-book-reader", ...)           │
│     ↑                                                                    │
│     处理 obsidian://local-book-reader?annotation=<excerptId> 反向跳转     │
├─────────────────────────────────────────────────────────────────────────┤
│ View 层                                                                  │
│   ┌───────────────┐  ┌─────────────────┐  ┌────────────────────────┐    │
│   │ library-view  │  │  reader-view    │  │  research-view         │    │
│   │ (书架/扫描)   │  │  (FileView)     │  │  (摘录与研究检索)      │    │
│   │               │  │  ┌──────────┐   │  │                        │    │
│   │               │  │  │ toolbar  │   │  │  多条件筛选 + 多选      │    │
│   │               │  │  │ bookmark │   │  │  + 创建/追加主题笔记    │    │
│   │               │  │  │ toc      │   │  │                        │    │
│   │               │  │  │ excerpts │   │  │                        │    │
│   │               │  │  │ stage    │   │  │                        │    │
│   │               │  │  └──────────┘   │  │                        │    │
│   └───────────────┘  └─────────────────┘  └────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│ Service 层                                                               │
│   ┌──────────────────┐  ┌────────────────────────┐                       │
│   │   BookStore      │  │   NoteService          │                       │
│   │ - library-index  │  │ - openOrCreateNote()   │                       │
│   │ - reading-state  │  │ - appendExcerpt()      │   ← 把摘录追加到       │
│   │ - settings       │  │ - appendThought()      │     vault md 笔记      │
│   │ - backup/cach    │  │ - appendResearchEntries│                       │
│   │ (单一真相源)     │  │ - listResearchEntries  │                       │
│   └──────────────────┘  └────────────────────────┘                       │
├─────────────────────────────────────────────────────────────────────────┤
│ Adapter 层                                                              │
│   - foliate-js (epub/mobi/azw via makeBook)                              │
│   - pdfjs-dist (pdf)                                                     │
│   - vault (notes/process/protocol)                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

**ez-reader 对照**:我们的 `core/adapters/ui` 分层与上面 Service/Adapter/View 一一对应,
但把 SunnyD0697 散落在 `main.ts` 里的协议注册、book-store 持久化逻辑拆成 `core/ports/AnnotationStore.ts` + `adapters/obsidian/ObsidianAnnotationStore.ts`。

---

## 二、关键代码片段(直接照搬)

### 1. EPUB 阅读器构建 + 目录 + 封面 + 元数据

SunnyD0697 的 `openReflowableBook` (reader-view.ts:586-672),关键 30 行:

```ts
const [{ makeBook }, { Overlayer }] = await Promise.all([
  import("foliate-js/view.js"),
  import("foliate-js/overlayer.js")
]);
const input = new File([fileData], file.name, { type: this.mimeType(file.extension) });
const book = await makeBook(input);                                  // ★ 1

this.currentMetadata = (() => {
  const metadata = extractBookMetadata((book as { metadata?: unknown }).metadata);
  return Object.keys(metadata).length ? { sourceModifiedAt: file.stat.mtime, ...metadata } : undefined;
})();
// 2. 缓存元数据
void this.plugin.cacheBookMetadata(file, this.currentMetadata).catch(...);

// 3. 异步提取封面
const getCover = (book as { getCover?: () => Promise<Blob | null> }).getCover;
if (typeof getCover === "function") {
  void getCover.call(book).then(async (cover) => {
    if (!cover || this.currentFile?.path !== file.path) return;
    await this.plugin.cacheBookCover(file, cover);
  });
}

this.toc = this.normalizeToc((book as { toc?: unknown }).toc);      // ★ 2 TOC 树
this.applyContentPolicy(book);                                       // ★ 3 安全净化

const view = document.createElement("foliate-view") as FoliateReaderElement;
view.setAttribute("data-local-book-reader-flow", this.plugin.getReaderAppearance(file.path).flow);
this.foliateView = view;
view.addEventListener("relocate", (event) => {                       // ★ 4 进度事件
  const detail = (event as CustomEvent<{ fraction?: number; tocItem?: { label?: string } }>).detail;
  this.currentReflowProgress = detail.fraction;
  this.currentChapter = detail.tocItem?.label ?? "";
  this.plugin.setReflowProgress(file.path, detail.fraction);
});
this.stage.append(view);
await view.open(book);
this.applyReaderAppearance();                                        // ★ 5 应用外观
const progress = this.plugin.getReflowProgress(file.path);
if (progress !== undefined) await view.goToFraction(progress);
else await view.goRight();
```

### 2. TOC 归一化(reader-view.ts:1335-1347)

```ts
private normalizeToc(value: unknown): TocItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TocItem[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { label?: unknown; href?: unknown; subitems?: unknown };
    if (typeof candidate.href !== "string" || !candidate.href) return [];
    return [{
      label: typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim() : "未命名章节",
      href: candidate.href,
      subitems: this.normalizeToc(candidate.subitems)
    }];
  });
}
```

### 3. TOC 面板渲染(reader-view.ts:1349-1389)

```ts
private renderTocPanel(): void {
  this.tocPanel.empty();
  this.tocPanel.toggleClass("is-hidden", !this.showingToc);
  if (!this.showingToc) return;
  this.tocPanel.createEl("h3", { text: t("目录") });
  if (this.toc.length === 0) {
    this.tocPanel.createDiv({ cls: "ebook-reader__bookmark-empty", text: t("当前书籍没有可用目录。") });
    return;
  }
  this.renderTocItems(this.tocPanel, this.toc, 0);
}

private renderTocItems(container: HTMLElement, items: TocItem[], depth: number): void {
  for (const item of items) {
    const button = container.createEl("button", { cls: "ebook-reader__toc-item", text: item.label });
    button.style.paddingInlineStart = `${0.5 + depth * 1}rem`;  // 缩进按层级
    button.onclick = () => void this.goToTocItem(item);
    if (item.subitems?.length) this.renderTocItems(container, item.subitems, depth + 1);
  }
}

private async goToTocItem(item: TocItem): Promise<void> {
  await this.foliateView.goTo(item.href);       // ★ href 已经是 CFI,直接 goTo
  this.showingToc = false;
  this.renderTocPanel();
}
```

### 4. 字号 / 行距 / 边距 / 主题应用(reader-view.ts:991-1037)

```ts
private applyReaderAppearance(): void {
  const settings = this.plugin.getReaderAppearance(this.currentFile?.path);
  const theme = settings.theme === "light"
    ? { background: "#ffffff", color: "#1f2328", scheme: "light" }
    : settings.theme === "dark"
      ? { background: "#1f2328", color: "#e6edf3", scheme: "dark" }
      : settings.theme === "sepia"
        ? { background: "#f4ecd8", color: "#4b3b2a", scheme: "light" }
        : { background: "Canvas", color: "CanvasText", scheme: "light dark" };

  // 1. 主舞台应用主题
  this.stage.setCssStyles({
    fontSize: `${settings.fontSize}%`,
    lineHeight: String(settings.lineHeight),
    paddingInline: `${settings.margin}px`,
    background: theme.background, color: theme.color, colorScheme: theme.scheme,
  });

  // 2. foliate iframe 内注入 CSS(foliate 自己不会响应 attributes 的全部字段)
  const renderer = this.foliateView?.renderer;
  if (!renderer?.setStyles) return;
  renderer.style.setProperty("--_margin", `${settings.margin}px`);
  renderer.setAttribute("flow", settings.flow);
  renderer.setStyles(`
    html, body {
      font-size: ${settings.fontSize}% !important;
      color: ${theme.color} !important;
      background: ${theme.background} !important;
      color-scheme: ${theme.scheme};
    }
    body { padding-inline: ${settings.margin}px !important; line-height: ${settings.lineHeight} !important; }
    p, li, blockquote, dd { line-height: ${settings.lineHeight} !important; }
  `);
}
```

**关键洞察**:`foliate-js` 自带 `<foliate-view>` 暴露的 `renderer.setStyles()` 方法是向 iframe 注入 CSS 的官方渠道 —— 这是 **必须用** 的,**不能用 `view.setAttribute("font-size", ...)` 之类的 attribute 方式**。

### 5. 划词 + CFI 获取(reader-view.ts:623-640 + 1168-1184)

```ts
// a. 在 foliate-view 的 load 事件里订阅 iframe doc 的 selectionchange
view.addEventListener("load", (event: Event) => {
  const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
  if (!detail?.doc || typeof detail.index !== "number") return;
  detail.doc.addEventListener("selectionchange", () => {
    this.captureReflowSelection(view, detail.doc!, detail.index!, file);
  });
});

// b. 捕获 selection → 调 view.getCFI(index, range) 拿 CFI
private captureReflowSelection(view: FoliateReaderElement, doc: Document, index: number, file: TFile): void {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) return;
  this.selectedExcerpt = {
    text,
    locator: {
      type: "reflow",
      fraction: this.currentReflowProgress,
      cfi: view.getCFI(index, range),                  // ★ 这里拿 CFI
      chapter: this.currentChapter || undefined
    }
  };
}
```

### 6. 划词 → 高亮(annotation)+ 删除(reader-view.ts:641-659 + 948-979)

```ts
// a. 自定义颜色:draft-annotation 事件拦截 foliate 自己的渲染
view.addEventListener("draw-annotation", (event) => {
  const detail = (event as CustomEvent<{
    annotation?: FoliateAnnotation;
    draw?: (draw: typeof Overlayer.highlight, options: { color: string }) => void;
  }>).detail;
  if (detail.annotation?.localBookReaderExcerpt) {
    detail.draw(Overlayer.highlight, { color: "#f3c94d" });   // 摘录=黄
  } else if (detail.annotation?.localBookReaderSearch) {
    detail.draw(Overlayer.highlight, { color: "#e75b5b" });   // 搜索=红
  }
});

// b. 重新打开书时批量恢复高亮(view.addEventListener("create-overlay"))
view.addEventListener("create-overlay", () => {
  for (const excerpt of this.plugin.getExcerpts(file.path)) {
    if (excerpt.locator.type !== "reflow") continue;
    void view.addAnnotation({ value: excerpt.locator.cfi, localBookReaderExcerpt: true });
  }
});

// c. 保存摘录时:1) 数据层 addExcerpt  2) foliate 高亮  3) Markdown 追加
private openExcerptModal(): void {
  new ExcerptModal(this.app, selection, async (note, tags) => {
    const excerpt = this.plugin.addExcerpt(file.path, selection.text, selection.locator, note, tags);
    await this.plugin.flushReadingState();                          // ★ 先存数据
    const readingNote = await this.plugin.appendExcerpt(file, excerpt);  // ★ 再写 md
    if (excerpt.locator.type === "reflow" && this.foliateView) {
      await this.foliateView.addAnnotation({
        value: excerpt.locator.cfi,
        localBookReaderExcerpt: true
      });
      this.foliateView.deselect();
    }
    this.renderExcerptPanel();
  }).open();
}
```

### 7. 翻页方式(键盘 + foliate 内置手势)

```ts
// 键盘(reader-view.ts:859-868)
private handleReaderKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
      || this.isEditableTarget(event.target)) return;
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault(); void this.previous();
  } else if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault(); void this.next();
  }
}
private isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], a"));
}

// foliate <foliate-view> 默认对 touch 启用 swipe,不需要自己实现
// 但 ez-reader 已经在 ReaderView.bindSwipeGestures() 手写了 50px 阈值版本
```

### 8. foliate-js 完整 API 使用方式汇总

| 用途 | API | 来源 |
|------|-----|------|
| 解析书 | `makeBook(file) → book` | `import("foliate-js/view.js")` |
| 书元数据 | `book.metadata` | foliate 自己解析 OPF |
| 章节树 | `book.toc` (label/href/subitems) | foliate 自己解析 NCX/NAX |
| 封面图 | `book.getCover() → Blob \| null` | foliate 自己解析 |
| HTML 净化 | `book.transformTarget.addEventListener("data", e => e.detail.data = sanitize(...))` | foliate 暴露的钩子 |
| 创建阅读器 | `document.createElement("foliate-view")` + `view.open(book)` | custom element |
| 翻页 | `view.goLeft()` / `view.goRight()` | |
| 跳转 | `view.goToFraction(f)` / `view.goTo(target)` (CFI 或 TOC href) | |
| 进度事件 | `view.addEventListener("relocate", e => e.detail.{fraction, tocItem, cfi})` | |
| 当前 CFI | `view.lastLocation.cfi` | |
| 拿选区 CFI | `view.getCFI(index, range) → cfiString` (index 由 load 事件给) | |
| 加/删高亮 | `view.addAnnotation({value: cfi, ...flag})` / `view.deleteAnnotation(...)` | |
| 自定义高亮颜色 | `view.addEventListener("draw-annotation", e => e.detail.draw(Overlayer.highlight, {color}))` | `import("foliate-js/overlayer.js")` |
| 搜索 | `view.search({query}) → AsyncIterable<{label, subitems, cfi, excerpt}>` | foliate 自己 |
| 清搜索 | `view.clearSearch()` | |
| 取消选区 | `view.deselect()` | |
| iframe 注入 CSS | `view.renderer.setStyles("...!important CSS...")` + `view.renderer.setAttribute("flow", ...)` | |
| 销毁 | `view.close()` + `view.remove()` | |

### 9. 笔记 / 摘录自动同步到 vault md(note-service.ts:24-130)

```ts
// a. appendExcerpt: 把 Excerpt 追加到 per-book 的笔记 md
async appendExcerpt(file: TFile, excerpt: Excerpt): Promise<TFile> {
  const note = await this.openOrCreateNote(file);                  // ★ 不存在就创建
  const source = this.describeExcerptLocator(excerpt);
  const quoteLines = excerpt.text.split(/\r?\n/).map((line) => `> ${line}`);
  const thoughtLines = excerpt.note ? [">", `> **Note**: ${excerpt.note}`] : [];
  const block = [
    "",
    `> [!quote] Excerpt`,                                            // ★ Obsidian callout
    `> Source: ${source} · ${book.extension.toUpperCase()}`,
    `> Created: ${excerpt.createdAt}`,
    `> Location: [Return to source](obsidian://local-book-reader?annotation=${encodeURIComponent(excerpt.excerptId)})`,
    ...this.markdownTags(excerpt.tags ?? []),
    ">",
    ...quoteLines,
    ...thoughtLines,
    "",
    `^${excerpt.excerptId}`,                                         // ★ 块引用锚点
    ""
  ].join("\n");
  await this.vault.process(note, (content) => `${content.replace(/\s*$/, "")}\n${block}`);
  return note;
}

// b. 协议注册(main.ts:228)
this.registerObsidianProtocolHandler("local-book-reader", (params) => {
  void this.openExcerptFromProtocol(params.annotation);
});

// c. 反向跳转(main.ts:openExcerptFromProtocol)
private async openExcerptFromProtocol(annotation: unknown): Promise<void> {
  const stored = this.findExcerpt(annotation);
  if (!stored) { new Notice("找不到这条摘录"); return; }
  const leaf = await this.openBook(file);
  await (leaf.view as { goToExcerpt?: (e: Excerpt) => Promise<void> }).goToExcerpt(stored.excerpt);
}
```

### 10. 双链笔记的实际形态(对照用户提问 "如何用 Obsidian 双链 [[书名#摘录]] 形式")

**结论:SunnyD0697 没用 `[[书名#摘录]]` wiki 链接,用 Obsidian 原生的 `obsidian://` 协议 + block ID。**

实际生成的 md 节选(note-service.ts:appendExcerpt 输出):

```markdown
> [!quote] 摘录
> Source: 第一章 · 阅读进度 23% · EPUB
> Created: 2025-03-15 14:32
> Location: [返回原文](obsidian://local-book-reader?annotation=abc-123-def)
> Tags: #哲学 #尼采

> 我已经预先走过了那种状态,现在我把它说成一种...

^abc-123-def

> [!note] 想法
> Source: 阅读进度 23% · EPUB
> Created: 2025-03-15 14:35

> 这里的"永恒轮回"概念比《查拉图斯特拉》早期表述更锋利。

^anno-uuid-987
```

**反向跳转机制**:
- 笔记里有链接 `[返回原文](obsidian://local-book-reader?annotation=abc-123-def)`
- 点击 → Obsidian 调起我们注册的 protocol handler → `openExcerptFromProtocol("abc-123-def")`
- handler 在 book-store 里按 excerptId 查 → 拿到 book + locator → 调 `reader.goToExcerpt(stored)`
- 实际跳的是 `foliateView.goTo(excerpt.locator.cfi)`

**这跟我们想的 `[[书名#摘录]]` wiki 链接不一样**:wiki 链接走 Obsidian 内置的 `link` 系统,需要在书名/章节/块都被解析时跳到对应文件;而 `obsidian://` 协议 + block ID `^abc-123-def` 是"指向同一笔记内的某个块"的标准做法,**跨笔记跳到原书** 必须用 protocol,因为我们要把"原书"和"阅读笔记"两个对象桥接起来。

**借鉴建议**:
1. 笔记内**块 ID** 必须用 `^<excerptId>`(已经够稳定了,excerptId 是 UUID)
2. **不**用 `[[书名]]` 因为原书是 EPUB/PDF,不是 Obsidian 笔记
3. 用 `obsidian://ez-reader?annotation=<excerptId>` 作为唯一反向链接
4. 如果用户确实要 `[[书名#摘录]]` 形式(每条摘录单独 md),可以**双写**:插件数据存原 CFI,每条摘录生成一个独立的 md 文件 `zz_阅读与研究/摘录/<excerptId>.md`,这样 vault 里的 md 互链就成了 wiki 链接。但 SunnyD0697 选了"一本书一个笔记 + block ID"的简化方案,**更省**。

### 11. 笔记面板 UI(research-view.ts:80-150,核心部分)

```ts
class BookResearchView extends ItemView {
  private query = ""; private bookQuery = ""; private tagQuery = "";
  private from = ""; private to = "";
  private readonly selectedExcerptIds = new Set<string>();       // ★ 多选状态
  private markdownEntries: ResearchMarkdownEntry[] | undefined;
  private markdownLoading = false;
  private markdownSearchGeneration = 0;                          // ★ 防止过期渲染

  // UI = 筛选栏 + 多选 + 标题输入 + 创建主题笔记
  const query = filters.createEl("input", { type: "search", placeholder: "..." });
  const book = filters.createEl("input", { type: "search", placeholder: "书名筛选" });
  const tag = filters.createEl("input", { type: "search", placeholder: "标签筛选" });
  const from = filters.createEl("input", { type: "date" });
  const to = filters.createEl("input", { type: "date" });
  const search = filters.createEl("button", { text: "搜索" });

  const title = compose.createEl("input", { type: "text", placeholder: "主题名称" });
  const create = compose.createEl("button", { text: "创建/追加主题研究笔记" });

  // 每条摘录渲染:checkbox + 引用 + 跳转
  const select = row.createEl("input", { type: "checkbox" });
  select.onchange = () => {
    if (select.checked) this.selectedExcerptIds.add(entry.excerpt.excerptId);
    else this.selectedExcerptIds.delete(entry.excerpt.excerptId);
  };
  row.createEl("blockquote", { text: entry.excerpt.text });
  const open = row.createEl("button", { text: "返回原文" });
  open.onclick = () => void this.plugin.openExcerptById(entry.excerpt.excerptId);
}

// 过滤
private matches(entry: StoredExcerpt): boolean {
  const text = `${entry.book.name}\n${entry.book.path}\n${entry.excerpt.text}\n${entry.excerpt.note}\n${tags.join(" ")}`.toLocaleLowerCase("zh-Hans-CN");
  if (this.query && !text.includes(this.query.toLocaleLowerCase())) return false;
  if (this.tag && !tags.some((t) => t.toLocaleLowerCase().includes(this.tag))) return false;
  if (this.from && dayOf(entry.excerpt.createdAt) < this.from) return false;
  // ...
}
```

### 12. 内容安全净化(避免 Electron 中 `<script>` 注入,reader-view.ts:686-697)

```ts
private sanitizeBookContent(source: string): string {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:src|poster|data)\s*=\s*(?:"(?:https?:|file:|javascript:)[^"]*"|'(?:https?:|file:|javascript:)[^']*'|(?:https?:|file:|javascript:)[^\s>]+)/gi, "");
}
```

**怎么挂上**:
```ts
private applyContentPolicy(book: unknown): void {
  const target = (book as { transformTarget?: EventTarget }).transformTarget;
  target?.addEventListener("data", (event) => {
    const detail = (event as CustomEvent<{ data: unknown; type?: string }>).detail;
    if (!detail || !/html|xhtml/i.test(detail.type ?? "")) return;
    detail.data = Promise.resolve(detail.data).then(async (data) => {
      const source = data instanceof Blob ? await data.text() : String(data);
      return this.sanitizeBookContent(source);
    });
  });
}
```

**我们的 FoliateBookReader 缺这个 hook** —— 这也是为什么 Android WebView 白屏的潜在根因之一(部分 EPUB 内的 script 触发 XHTML parse 失败)。

---

## 三、可以借鉴的实现细节

| 借鉴点 | SunnyD0697 做法 | ez-reader 改进方向 |
|--------|----------------|--------------------|
| **目录展示** | 扁平化为 `TocItem[]`,每层 `paddingInlineStart` 缩进,纯按钮 + 点击 `goTo(href)` | **新建** `src/ui/reader/TocPanel.ts`(对标 BookmarksPanel),用相同的 `<div>.createEl("button")` 风格,缩进通过 `style.paddingInlineStart = ${depth * 1}rem` |
| **划词 CFI 获取** | 在 `view.addEventListener("load")` 里订阅 iframe `selectionchange`,调用 `view.getCFI(index, range)` | 我们的 `FoliateBookReader.bindSelectionChange` 已经走 shadow DOM 取 iframe,只缺 **`view.getCFI(index, range)` 调用** —— 当前只把 `lastLocation.cfi` 当粗粒度用 |
| **划词工具栏触发** | 监听 selectionchange → 把 `{text, rect}` 存到 `this.selectedExcerpt` → 工具栏"摘录"按钮读它 | 我们已经有 `ReaderSelectionMenu.show(rect)`,但要把它**改成 "选中即弹"** 而不是依赖按钮触发 —— selectionchange 触发 `show()` |
| **划词高亮持久化** | `view.addEventListener("create-overlay")` 重新打开书时批量 `addAnnotation(value: cfi, localBookReaderExcerpt: true)`,通过 `draw-annotation` 拦截器上色 | 我们的 `FoliateSession.addAnnotation(cfi)` 没有颜色标志位 —— 加上 `localBookReaderExcerpt: true` 标志 + 监听 `draw-annotation` |
| **字号/行距/边距应用到 foliate** | `renderer.setStyles("!important CSS")` + `setAttribute("flow", ...)` | **当前 ez-reader 错用了 setAttribute**(`FoliateBookReader.applyAppearance`),改成 setStyles CSS 字符串注入才是正解 |
| **键盘翻页** | `ArrowLeft` / `ArrowRight` / `PageUp` / `PageDown` + `event.target.closest("input, textarea, ...)` 过滤 | 我们的 `ReaderView` 没注册 keyboard handler —— 加 `bindKeyboardNavigation()` |
| **手势翻页** | 50px 阈值 `touchstart/touchend`,`Math.abs(dx) < 50 \|\| Math.abs(dx) <= Math.abs(dy) * 1.5` 排除竖滑 | 已有 `bindSwipeGestures`,**但阈值 50 + dy 倍率 1.5** 跟 SunnyD0697 一致,**不需改** |
| **笔记 → md** | `vault.process(note, content => append block)`,block 含 `[!quote]` admonition + `^<excerptId>` block ID + `obsidian://<plugin-id>?annotation=<id>` 反向链接 | **新建** `src/adapters/obsidian/ObsidianNoteWriter.ts`(实现 port 接口)+ `src/core/ports/NoteWriter.ts`(纯逻辑) |
| **协议反向跳转** | `registerObsidianProtocolHandler("ez-reader", params => goToExcerpt(excerptId))` | 在 `Plugin.ts` 里挂 |
| **摘录侧边栏自动添加** | `openExcerptModal` 完成后直接 `this.renderExcerptPanel()` 立即刷新 | 我们已经有 `refreshPanels()`,只要在 `saveExcerptFromSelection()` 末尾加一行 |
| **块 ID** | `^<uuid>` 是稳定锚点 | 直接复用 |
| **多条件筛选 + 多选 + 主题笔记** | research-view 用了 `Set<excerptId>` + 标题输入 + "创建/追加"按钮 | 我们的 roadmap 里没有这个面板,作为 P2 可加 |

---

## 四、对 ez-reader 的具体建议(可以直接执行的方案)

### A. 必做(P0,补足当前缺口)

#### A.1 新增 port 接口(在 `core/ports/`)

```ts
// src/core/ports/NoteWriter.ts
import type { App } from "obsidian"; // ← 错,这是 port,不能用 obsidian
```

**正确做法** —— port 不引 obsidian,放一个抽象接口:

```ts
// src/core/ports/NoteWriter.ts (新文件)
export interface ExcerptInput {
  readonly text: string;
  readonly note: string;
  readonly tags: ReadonlyArray<string>;
  readonly locator: { readonly cfi?: string; readonly fraction: number; readonly page?: number };
  readonly excerptId: string;
  readonly createdAt: number;
  readonly chapterTitle?: string;
  readonly format: "epub" | "pdf" | "txt" | "mobi";
}

export interface NoteWriter {
  ensureBookNote(input: {
    readonly bookId: string;
    readonly bookTitle: string;
    readonly bookPath: string;
  }): Promise<NoteRef>;

  appendExcerpt(ref: NoteRef, input: ExcerptInput): Promise<void>;
  appendThought(ref: NoteRef, input: { text: string; locator: string; createdAt: number; tags: ReadonlyArray<string> }): Promise<void>;

  /** Resolve an obsidian:// protocol deep-link back to an Excerpt. */
  resolveExcerptLink(excerptId: string): Promise<{ bookId: string; format: string; locator: unknown } | null>;
}

export interface NoteRef {
  readonly path: string;
  readonly file: unknown; // 由 adapter 实现,可以是 TFile
}
```

#### A.2 新增 adapter(在 `adapters/obsidian/`)

```ts
// src/adapters/obsidian/ObsidianNoteWriter.ts (新文件,核心实现)
// - 复用 SunnyD0697 的 vault.process + callout + ^excerptId 模式
// - 反向链接用 obsidian://ez-reader?annotation=<id>
// - ensureBookNote 用 settings.notesDirectory 拼接 <title>-<bookId前8位>.md
```

#### A.3 ReaderSession 扩展

```ts
// src/core/ports/BookReader.ts:ReaderSession 加 3 个方法
export interface ReaderSession {
  // 已有方法不变 ...

  /** 划词 → 拿精细 CFI(index 由框架给,Range 由 selectionchange 给) */
  resolveCFI?(index: number, range: Range | undefined): string;

  /** 高亮开关(用 flag 让 draw-annotation 染色) */
  addAnnotation?(cfi: string, kind: "excerpt" | "search"): Promise<void>;
  removeAnnotation?(cfi: string, kind: "excerpt" | "search"): Promise<void>;

  /** 拿到 TOC 树(foliate 暴露 book.toc) */
  getToc?(): ReadonlyArray<{ label: string; href?: string; subitems?: ReadonlyArray<unknown> }>;
}
```

#### A.4 UI 新增/修改文件

| 文件 | 动作 |
|------|------|
| `src/ui/reader/TocPanel.ts` | **新建**,镜像 `BookmarksPanel.ts` 风格 |
| `src/ui/reader/ReaderView.ts` | 加 `bindKeyboardNavigation()`,加 `saveExcerptFromSelection` 末尾 `refreshPanels()`,加 `onOpenSession` 监听 `create-overlay` 恢复高亮 |
| `src/ui/reader/ReaderSelectionMenu.ts` | 改"划词即弹"—— selectionchange 触发,不再依赖按钮 |
| `src/adapters/foliate/FoliateBookReader.ts` | 改 `applyAppearance` 用 `renderer.setStyles(css)`(参照 SunnyD0697 片段 4),加 `resolveCFI/addAnnotation/removeAnnotation/getToc`,监听 `draw-annotation` + `create-overlay` |
| `src/Plugin.ts` | `registerObsidianProtocolHandler("ez-reader", ...)` 桥接到 `ReaderView.goToExcerpt` |

### B. 强烈推荐(P1,体验升级)

#### B.1 沉浸模式(Pad)

```ts
// src/ui/reader/ImmersiveMode.ts (新建,约 60 行)
export class ReaderImmersiveController {
  private originalOverflow = "";
  private originalPaddingBottom = "";
  constructor(private readonly view: ItemView) {}
  enter(): void {
    this.originalOverflow = document.body.style.overflow;
    this.originalPaddingBottom = document.body.style.paddingBottom;
    document.body.style.overflow = "hidden";
    // 关键:toolbar 隐藏 + 触摸任意区域再呼出
    this.view.containerEl.addClass("ez-reader__immersive");
  }
  exit(): void {
    document.body.style.overflow = this.originalOverflow;
    document.body.style.paddingBottom = this.originalPaddingBottom;
    this.view.containerEl.removeClass("ez-reader__immersive");
  }
}
```

CSS 加:
```css
.ez-reader__immersive .ez-reader__reader-toolbar { transform: translateY(-100%); transition: transform .2s; }
.ez-reader__immersive.touched .ez-reader__reader-toolbar { transform: translateY(0); }
.ez-reader__immersive .ez-reader__reader-panel { display: none; }
@media (max-width: 1024px) {
  /* Pad 默认进沉浸模式 */
  .ez-reader__reader.is-tablet .ez-reader__reader-toolbar { opacity: 0.3; }
}
```

#### B.2 双页 / 单页切换(桌面)

```ts
// 在 FoliateBookReader 的 applyAppearance 里加:
const cols = appearance.columns === "two" ? "2" : "1";
this.view.setAttribute("cols", cols);                       // foliate 原生支持
// 或注入 CSS:.foliate-view iframe html { column-count: 2; }

// 加 ReaderAppearance 字段
export interface ReaderAppearance {
  // 现有 ...
  readonly columns: "one" | "two";
}

// AppearanceModal 加列数单选
```

#### B.3 摘录立即同步侧边栏

```ts
// 在 ReaderView.saveExcerptFromSelection 末尾
await this.deps.reading.addExcerpt({...});
if (this.showingExcerpts) {
  await this.refreshPanels();        // ★ 已经实现,只要确保 showingExcerpts=true 时调
} else {
  this.excerptsPanel?.setExcerpts(await this.deps.reading.listExcerpts(this.entry.book.id));
}
this.excerptsPanel?.flashLast(excerpt.id);                  // 新建 flashLast 方法,高亮最近一条
```

### C. 暂不做(P2/P3)

- **多选 + 主题研究笔记面板**(SunnyD0697 的 research-view)—— 我们已经有 TranslationModal 路径,这个 P3 之后再考虑
- **自动备份核心数据** —— SunnyD0697 有,我们的 `AnnotationStore` 是单 JSON 写入,不需要备份,够简单
- **i18n 切换实时生效** —— SunnyD0697 做了 en/zh-CN/zh-TW/fr,我们目前只 zh-CN
- **搜索正文**(SunnyD0697 的 SearchModal + foliate.search)—— P3

---

## 五、总结执行清单(按 P0→P1 排序)

```text
[P0] 1. 新建 src/core/ports/NoteWriter.ts (port 接口)
[P0] 2. 新建 src/adapters/obsidian/ObsidianNoteWriter.ts (实现 + vault.process + ^id + obsidian:// 协议)
[P0] 3. 改 src/core/ports/BookReader.ts:ReaderSession 加 resolveCFI/addAnnotation/removeAnnotation/getToc
[P0] 4. 改 src/adapters/foliate/FoliateBookReader.ts:applyAppearance 用 renderer.setStyles
[P0] 5. 改 src/adapters/foliate/FoliateBookReader.ts:监听 draw-annotation 和 create-overlay,加 addAnnotation(cfi, kind)
[P0] 6. 新建 src/ui/reader/TocPanel.ts
[P0] 7. 改 src/ui/reader/ReaderView.ts:加 bindKeyboardNavigation + 摘录后 refreshPanels + create-overlay 恢复高亮
[P0] 8. 改 src/ui/reader/ReaderSelectionMenu.ts:选中即弹
[P0] 9. 改 src/Plugin.ts:registerObsidianProtocolHandler + 把 NoteWriter 注入 Plugin
[P0] 10. 加 styles.css:.ez-reader__toc-item padding 缩进 / .ez-reader__theme-* 主题 class
[P1] 11. 新建 src/ui/reader/ImmersiveMode.ts (Pad 沉浸模式)
[P1] 12. 改 ReaderAppearance 加 columns 字段 + foliate setAttribute("cols", ...)
[P1] 13. ExcerptsPanel 加 flashLast 高亮最近一条
```

**预计代码量**:P0 ≈ 350 行新增 + 80 行修改;P1 ≈ 120 行新增。**不动 core/ 任何已有 entity,不动 AnnotationStore,不动 PdfjsBookReader**。

---

## 六、最重要的 3 个 takeaway

1. **foliate 的 `renderer.setStyles("!important CSS")` 是字号/行距/边距生效的唯一正解**,不要尝试 `view.setAttribute("font-size", ...)`,foliate 不监听。我们的 `FoliateBookReader.applyAppearance` 当前用 attribute + gap,这是错的 —— 见片段 4。

2. **划词 CFI 必须从 iframe 里拿**,路径是 `view.addEventListener("load", e => e.detail.doc.addEventListener("selectionchange", ...))`,然后在 selectionchange 里调 `view.getCFI(index, range)`。我们的 `bindSelectionChange` 已经走到了 iframe,只缺 `getCFI` 调用。

3. **反向跳转用 `obsidian://<plugin-id>?annotation=<excerptId>` + `^<excerptId>` 块 ID,不用 `[[书名#摘录]]`** —— 这是 SunnyD0697 的标准做法。原因:原书不是 Obsidian 笔记,wiki 链接不能跨格式跳。块 ID + 协议是 Obsidian 原生支持的"笔记内部锚点 + 跨笔记跳转"组合。
