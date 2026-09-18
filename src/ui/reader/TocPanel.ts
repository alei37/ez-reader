import type { TocItem } from "../../core/ports/BookReader";

export interface TocPanelHandlers {
  onJump: (item: TocItem) => void;
  /** Close-button on the panel header. Defaults to no-op if not provided. */
  onClose?: () => void;
}

/**
 * 内部树节点 — 由扁平 TocItem[] (按 depth 推栈) 构造, 只在 render 时
 * 用, 不暴露给外部. 导出 buildTocTree 给 unit test 复用.
 */
export interface TocTreeNode {
  readonly item: TocItem;
  readonly children: TocTreeNode[];
}

/**
 * 把扁平的 TocItem[] 按 depth 字段构造成嵌套树. 假设 items 按文档顺序
 * 排列, depth 单调非严格递增 — foliate / 内置 TXT/MOBI parser 都满足.
 *
 * 算法: 维护一个祖先栈, 遇到新 item 时把 depth >= 当前 item.depth 的栈
 * 顶 pop 掉, 这样栈顶就是最近一个 depth 更小的祖先 (= 父节点).
 *
 * 例外: depth 跳级 (depth=0 直接到 depth=2) 也安全 — 栈 pop 后剩 depth=0
 * 节点, depth=2 正确挂到它下面. depth 倒退 (depth=2 → depth=0) 也安全 —
 * 栈清空, depth=0 节点变成根.
 */
export function buildTocTree(items: ReadonlyArray<TocItem>): TocTreeNode[] {
  const roots: TocTreeNode[] = [];
  const stack: TocTreeNode[] = [];
  for (const item of items) {
    const node: TocTreeNode = { item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].item.depth >= item.depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/**
 * 递归过滤: node 自身或任一后代匹配 predicate 时保留, 同时保留匹配的
 * 后代. 不匹配的分支整支砍掉 — 这样折叠搜索时不会留空壳.
 */
function filterTocTree(
  nodes: ReadonlyArray<TocTreeNode>,
  predicate: (item: TocItem) => boolean
): TocTreeNode[] {
  const result: TocTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTocTree(node.children, predicate);
    if (predicate(node.item) || filteredChildren.length > 0) {
      result.push({ item: node.item, children: filteredChildren });
    }
  }
  return result;
}

/**
 * 找到从根到目标 id 的祖先链 (不含目标 id 自己). 用于面包屑.
 */
function ancestorPathOf(nodes: ReadonlyArray<TocTreeNode>, targetId: string): TocItem[] {
  const path: TocItem[] = [];
  const visit = (ns: ReadonlyArray<TocTreeNode>): boolean => {
    for (const n of ns) {
      if (n.item.id === targetId) return true;
      if (visit(n.children)) {
        path.unshift(n.item);
        return true;
      }
    }
    return false;
  };
  visit(nodes);
  return path;
}

/**
 * Sidebar (左侧) 形式的目录面板 — 树状结构, 父项 ▶/▼ 折叠, 子项缩进 +
 * 竖线连接, 当前章节高亮 + 自动展开祖先. 跟 notesPanel 共享左侧 320px
 * 边栏布局 (互斥显示 — Esc 关一个开另一个).
 *
 * 搜索: 过滤后保留匹配节点和它们的祖先链, 视觉上一目了然.
 *
 * Tier 1 增强 (v5):
 * - 键盘导航: ↑/↓ Home End ←/→ Enter Esc. 只在 panel visible 且事件
 *   target 在 panel 内时处理. ReaderView 容器层的 keyboard handler 在
 *   capture 阶段先跑 — 它对箭头 / Enter 没路由, 所以两者自然不冲突.
 *   Home/End/Space 的冲突通过 ReaderView 在 tocPanel 可见时跳过 action
 *   来解决 (详见 ReaderView.bindKeyboardNavigation 的 `containsPanel`).
 * - scrollActiveIntoView: setActive 滚到可视区一次, 用 lastScrolledId
 *   记录已滚过的, 避免每次 relocate 都滚 (会干扰用户手动滚动).
 * - 面包屑 (header 下方): 显示当前章节的祖先链, 点任一节跳过去.
 * - 章节计数 chip (header 标题右边).
 *
 * Tier 2 #6 (visited / current / unvisited 圆点): 通过 setVisited 注入
 * 已访问 id 集合 (ReaderView.tocFractions.keys()), 圆点 CSS class 切换.
 */
export class TocPanel {
  readonly root: HTMLElement;
  private readonly handlers: TocPanelHandlers;
  private items: ReadonlyArray<TocItem> = [];
  private tree: TocTreeNode[] = [];
  private query: string = "";
  private activeId: string | null = null;
  /** 用户手动折叠过的父节点 id 集合 (collapsed). 默认全部展开. */
  private collapsed: Set<string> = new Set();
  /** 搜索时临时展开的祖先 id — search 清空时清掉. */
  private searchExpanded: Set<string> = new Set();
  /** 当前键盘焦点所在的 row id — null 表示没有焦点. */
  private focusedId: string | null = null;
  /** 已经自动滚动过可视区的 activeId 集合 — setActive 同 id 不重复滚. */
  private scrolledIds: Set<string> = new Set();
  /** 已访问章节 id 集合 (来自 ReaderView.tocFractions) — 渲染圆点用. */
  private visitedIds: Set<string> = new Set();
  /** 一次性的 capture keydown listener 引用, 用于 dispose 时摘掉. */
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(handlers: TocPanelHandlers, host: HTMLElement) {
    this.handlers = handlers;
    // 左侧边栏布局 — 跟 notesPanel 同侧. CSS 用 .ez-reader__reader-panel--toc-sidebar
    // (区别于旧的 top drop-down 类 .ez-reader__reader-panel--toc).
    this.root = host.createDiv({
      cls: "ez-reader__reader-panel ez-reader__reader-panel--toc-sidebar is-hidden"
    });
    // 键盘监听挂在 panel root 上 (capture: true), 只在 panel 可见时响应.
    // 这样:
    // - 焦点在 reader 内容 (foliate iframe / paged text stage) 时, 事件
    //   target 不在 panel 内, panel handler 直接 return, 让 ReaderView
    //   容器层 handler 正常处理翻页等.
    // - 焦点在 panel 内 (用户 Tab 进 panel 或点 row) 时, 我们接管箭头 /
    //   Enter / Esc.
    // ReaderView 在 tocPanel 可见时也会跳过 target 在 panel 内的容器层
    //   快捷键 (见 ReaderView.bindKeyboardNavigation).
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.root.addEventListener("keydown", this.onKeyDown, true);
    this.renderHeader();
    this.renderList();
  }

  setToc(items: ReadonlyArray<TocItem>): void {
    this.items = items;
    this.tree = buildTocTree(items);
    this.query = "";
    this.collapsed = new Set();
    this.searchExpanded = new Set();
    this.focusedId = null;
    this.scrolledIds = new Set();
    this.visitedIds = new Set();
    this.renderHeader();
    this.renderList();
  }

  /**
   * 更新当前激活章节 id.
   *
   * 副作用:
   * - 自动展开祖先 (跟 setActive 之前一致)
   * - 重置焦点到 active row (如果面板可见且当前没手动设焦点)
   * - scrollActiveIntoView: 第一次激活到这个 id 时滚到可视区, 之后同 id
   *   重复 setActive 不滚 (relocate 风暴期间会重复触发, 每次都滚会干扰
   *   用户手动滚动).
   */
  setActive(id: string | null): void {
    const prev = this.activeId;
    this.activeId = id;
    if (id) {
      this.expandAncestorsOf(id);
    }
    this.refreshActiveAndCollapseStyles();
    this.refreshVisitedStyles();
    this.refreshBreadcrumb();
    // 面板可见 + 用户没手动 focus 到别的 row → 自动把焦点跟到 active row.
    if (id && this.isVisible()) {
      const hadUserFocus = this.focusedId !== null && this.focusedId !== prev;
      if (!hadUserFocus) {
        this.focusedId = id;
        this.applyFocusedClass();
      }
      this.scrollActiveIntoView(id);
    }
  }

  /**
   * 标记已访问章节 id 集合 — ReaderView 在 relocate 时被动记录
   * tocFractions, 把 keys() 同步过来. 用于 row 右侧的 visited/current/
   * unvisited 圆点.
   */
  setVisited(ids: Iterable<string>): void {
    this.visitedIds = new Set(ids);
    this.refreshVisitedStyles();
  }

  show(): void {
    this.root.removeClass("is-hidden");
    // 打开时如果还没有焦点, 把焦点跟到 active row, 键盘导航立即可用.
    // 同步滚到可视区 — 即使之前 setActive 时 panel 是 hidden (scrollIntoView
    // 是 no-op), 现在用户打开 panel, 应当看到当前章节.
    if (this.activeId && this.focusedId === null) {
      this.focusedId = this.activeId;
      this.applyFocusedClass();
      // 强制 scrollIntoView (scrolledIds 没考虑 hidden 时 setActive 的
      // no-op, 这里手动滚一次).
      this.scrollActiveIntoView(this.activeId);
    } else if (this.activeId === null) {
      // 没 active 时, 焦点到第一个可见 row.
      const first = this.firstVisibleRow();
      if (first) {
        this.focusedId = first.getAttribute("data-toc-id");
        this.applyFocusedClass();
      }
    }
  }

  hide(): void {
    this.root.addClass("is-hidden");
    // 关闭时清掉 focus 视觉, 避免下次打开时焦点在已 collapse 的 row.
    this.focusedId = null;
    this.applyFocusedClass();
  }

  toggle(): void {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
    if (this.isVisible()) {
      // 跟 show() 一样的初始 focus + scroll 逻辑.
      if (this.activeId && this.focusedId === null) {
        this.focusedId = this.activeId;
        this.applyFocusedClass();
        this.scrollActiveIntoView(this.activeId);
      } else if (this.activeId === null) {
        const first = this.firstVisibleRow();
        if (first) this.focusedId = first.getAttribute("data-toc-id");
        this.applyFocusedClass();
      } else {
        this.applyFocusedClass();
      }
    } else {
      this.focusedId = null;
      this.applyFocusedClass();
    }
  }

  isVisible(): boolean {
    return !this.root.hasClass("is-hidden");
  }

  /** 给 ReaderView bindKeyboardNavigation 用 — event.target 是否在 panel 内. */
  contains(node: EventTarget | Node | null): boolean {
    if (!node || !(node instanceof Node)) return false;
    return this.root.contains(node);
  }

  // ---- 内部 ----

  private expandAncestorsOf(id: string): void {
    // 在 tree 里走一次, 找到 id 对应节点, 把路径上所有祖先从 collapsed 移出.
    const path: string[] = [];
    const visit = (nodes: TocTreeNode[]): boolean => {
      for (const n of nodes) {
        if (n.item.id === id) return true;
        if (visit(n.children)) {
          path.push(n.item.id);
          return true;
        }
      }
      return false;
    };
    visit(this.tree);
    let needsRerender = false;
    for (const ancestorId of path) {
      if (this.collapsed.has(ancestorId)) {
        this.collapsed.delete(ancestorId);
        needsRerender = true;
      }
      this.searchExpanded.add(ancestorId);
    }
    // 如果 collapsed 集合有变化, list 里的 display:none 需要重渲染才能生效.
    if (needsRerender) {
      this.renderList();
    }
  }

  /**
   * 滚动 active row 到可视区 — 只滚一次 (per session). 同 id 重复
   * setActive 不滚 (relocate 风暴里 ReaderView 会频繁 setActive). 换书
   * 后 (setToc) 清空, 让新书能自动滚到第一章节.
   */
  private scrollActiveIntoView(id: string): void {
    if (this.scrolledIds.has(id)) return;
    this.scrolledIds.add(id);
    const row = this.root.querySelector<HTMLElement>(`.ez-reader__toc-row[data-toc-id="${id}"]`);
    if (!row) return;
    // scrollIntoView 在 jsdom 里是 no-op, 用 try/catch 兜底 (旧浏览器不支持).
    try {
      row.scrollIntoView({ block: "nearest" });
    } catch {
      /* noop */
    }
  }

  private renderHeader(): void {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__toc-header" });
    const titleRow = headerRow.createDiv({ cls: "ez-reader__panel-header-title" });
    const title = titleRow.createEl("h3", { text: "目录" });
    // Tier 1 #4: 章节计数 chip — 紧跟标题后面, 灰色小字.
    if (this.items.length > 0) {
      const count = titleRow.createEl("span", {
        text: `${this.items.length} 章`,
        attr: { "aria-label": `共 ${this.items.length} 章` }
      });
      count.addClass("ez-reader__toc-count");
    }
    // P0 修复: 之前 panel 打开后用户无法直接关闭 — 必须再去点 toolbar 上的
    // toggle 按钮, 在沉浸模式下 toolbar 不可见, 用户被迫只能重启 viewer.
    // 现在 panel header 加一个显式 × 按钮, 同时 Esc 键绑定 (ReaderView 统一处理).
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "×",
        attr: { type: "button", title: "关闭面板 (Esc)", "aria-label": "关闭面板" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    if (this.items.length >= 8) {
      const search = headerRow.createEl("input", {
        attr: { type: "search", placeholder: "搜索章节...", "aria-label": "搜索章节" }
      });
      search.addClass("ez-reader__toc-search");
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value.trim().toLocaleLowerCase();
        // 搜索时清空 searchExpanded, 让用户输入新 query 后从干净状态展开.
        this.searchExpanded = new Set();
        this.renderList();
      });
    }
    // 面包屑占位 — renderBreadcrumb 在 setActive 里填.
    headerRow.createDiv({ cls: "ez-reader__toc-breadcrumb" });
    // 占位 div 之后, 给 title 加 click 锚点 (无操作, 保留 layout 槽位)
    title.setAttribute("data-toc-header-title", "1");
  }

  private renderBreadcrumb(): void {
    const slot = this.root.querySelector<HTMLElement>(".ez-reader__toc-breadcrumb");
    if (!slot) return;
    slot.empty();
    if (!this.activeId) return;
    const ancestors = ancestorPathOf(this.tree, this.activeId);
    const chain: TocItem[] = [...ancestors];
    // 把 active item 自己也算进链 (最右边一级, 不可点).
    const activeNode = this.findNodeById(this.tree, this.activeId);
    if (activeNode) chain.push(activeNode.item);
    if (chain.length === 0) return;
    chain.forEach((item, idx) => {
      const isLast = idx === chain.length - 1;
      if (idx > 0) {
        const sep = slot.createSpan({ text: "›", attr: { "aria-hidden": "true" } });
        sep.addClass("ez-reader__toc-breadcrumb__sep");
      }
      const span = slot.createSpan({
        text: item.label,
        attr: {
          title: item.label,
          "aria-label": isLast ? `当前位置: ${item.label}` : `跳到 ${item.label}`
        }
      });
      span.addClass("ez-reader__toc-breadcrumb__item");
      if (isLast) {
        span.addClass("is-current");
      } else {
        span.addClass("is-link");
        span.addEventListener("click", () => this.handlers.onJump(item));
      }
    });
  }

  /** 已知树是平坦的 list of TocItem, 找到对应 TocTreeNode (任意深度). */
  private findNodeById(nodes: ReadonlyArray<TocTreeNode>, id: string): TocTreeNode | null {
    for (const n of nodes) {
      if (n.item.id === id) return n;
      const found = this.findNodeById(n.children, id);
      if (found) return found;
    }
    return null;
  }

  private refreshBreadcrumb(): void {
    this.renderBreadcrumb();
  }

  private renderList(): void {
    // 移除旧 list (保留 header — header 在 renderHeader 时已创建).
    const old = this.root.querySelector(".ez-reader__toc-tree");
    if (old) old.remove();
    const oldEmpty = this.root.querySelector(".ez-reader__reader-panel__empty");
    if (oldEmpty) oldEmpty.remove();
    // 标题下的空状态 (没有 toc items)
    if (this.items.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: "本书没有可用目录。"
      });
      return;
    }
    const filtered = this.query
      ? filterTocTree(this.tree, (it) =>
          it.label.toLocaleLowerCase().includes(this.query)
        )
      : this.tree;
    if (filtered.length === 0) {
      const empty = this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: `没有匹配的章节 (${this.query}).`
      });
      empty.addClass("ez-reader__toc-tree");
      return;
    }
    const list = this.root.createDiv({ cls: "ez-reader__toc-tree" });
    for (const node of filtered) {
      this.renderNode(node, list, 0);
    }
    this.refreshActiveAndCollapseStyles();
    this.refreshBreadcrumb();
    this.refreshVisitedStyles();
    this.applyFocusedClass();
  }

  private renderNode(node: TocTreeNode, parent: HTMLElement, depth: number): void {
    const row = parent.createDiv({ cls: "ez-reader__toc-row" });
    row.style.setProperty("--toc-depth", String(depth));
    row.setAttribute("data-toc-id", node.item.id);
    row.setAttribute("data-toc-depth", String(node.item.depth));

    const hasChildren = node.children.length > 0;
    if (hasChildren) {
      row.addClass("is-parent");
    }

    // 折叠/展开 toggle — 仅在有 children 时渲染, 占位用空白 span 保持对齐.
    const toggle = row.createEl("button", {
      text: hasChildren ? "▾" : "",
      attr: {
        type: "button",
        tabindex: "-1",
        "aria-label": hasChildren ? "折叠/展开子章节" : "",
        "data-toc-toggle": "1"
      }
    });
    toggle.addClass("ez-reader__toc-row__toggle");
    if (!hasChildren) {
      toggle.addClass("is-empty");
      toggle.disabled = true;
    } else {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.collapsed.has(node.item.id)) {
          this.collapsed.delete(node.item.id);
        } else {
          this.collapsed.add(node.item.id);
          // 用户主动折叠覆盖 searchExpanded (跟键盘一致).
          this.searchExpanded.delete(node.item.id);
        }
        this.refreshActiveAndCollapseStyles();
      });
    }

    // 章节 label — Tier 2 #5: 搜索时高亮匹配的子串 (用 <mark>).
    const label = row.createEl("button", {
      attr: {
        type: "button",
        title: node.item.label,
        "aria-label": `跳到 ${node.item.label}`
      }
    });
    label.addClass("ez-reader__toc-row__label");
    this.fillLabelWithHighlight(label, node.item.label, this.query);
    label.addEventListener("click", () => this.handlers.onJump(node.item));

    // Tier 2 #6: 章节进度点 — row 末尾的 3px 圆点 (visited/current/unvisited).
    // CSS class 由 refreshVisitedStyles 根据 visitedIds + activeId 写入.
    const dot = row.createSpan({ attr: { "aria-hidden": "true" } });
    dot.addClass("ez-reader__toc-progress-dot");

    // 子节点容器 — 折叠时 display:none.
    if (hasChildren) {
      const children = parent.createDiv({ cls: "ez-reader__toc-children" });
      children.setAttribute("data-toc-children-of", node.item.id);
      for (const child of node.children) {
        this.renderNode(child, children, depth + 1);
      }
    }
  }

  /**
   * 把 label 写到容器里, 把 query 子串包成 <mark>. 没 query 时整段做
   * textContent — 安全 (不解析 HTML). case-insensitive 匹配 (跟 query
   * lowercase 一致).
   */
  private fillLabelWithHighlight(container: HTMLElement, label: string, query: string): void {
    container.textContent = "";
    if (!query) {
      container.textContent = label;
      return;
    }
    const lowerLabel = label.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    let cursor = 0;
    while (cursor < label.length) {
      const idx = lowerLabel.indexOf(lowerQuery, cursor);
      if (idx < 0) {
        container.appendChild(container.ownerDocument.createTextNode(label.slice(cursor)));
        return;
      }
      if (idx > cursor) {
        container.appendChild(container.ownerDocument.createTextNode(label.slice(cursor, idx)));
      }
      const mark = container.ownerDocument.createElement("mark");
      mark.addClass("ez-reader__toc-highlight");
      mark.textContent = label.slice(idx, idx + lowerQuery.length);
      container.appendChild(mark);
      cursor = idx + lowerQuery.length;
    }
  }

  private refreshActiveAndCollapseStyles(): void {
    const rows = this.root.querySelectorAll<HTMLElement>(".ez-reader__toc-row");
    rows.forEach((r) => {
      const id = r.getAttribute("data-toc-id");
      r.toggleClass("is-active", id === this.activeId);
      // toggle 文字: 默认 ▾ (展开), collapsed 时 ▸.
      if (r.hasClass("is-parent")) {
        const toggle = r.querySelector<HTMLElement>(".ez-reader__toc-row__toggle");
        if (toggle && !toggle.classList.contains("is-empty")) {
          toggle.textContent = id && this.collapsed.has(id) ? "▸" : "▾";
        }
      }
    });
    // 折叠 children 容器.
    const childContainers = this.root.querySelectorAll<HTMLElement>(
      ".ez-reader__toc-children"
    );
    childContainers.forEach((c) => {
      const parentId = c.getAttribute("data-toc-children-of");
      if (!parentId) return;
      const collapsed =
        this.collapsed.has(parentId) &&
        !this.searchExpanded.has(parentId);
      c.toggleClass("is-collapsed", collapsed);
    });
  }

  /**
   * 根据 visitedIds + activeId 给每个 row 的进度点写 CSS class:
   * - activeId: is-current (蓝)
   * - visitedIds (含 activeId): is-visited (绿)
   * - 其他: is-unvisited (灰)
   */
  private refreshVisitedStyles(): void {
    const rows = this.root.querySelectorAll<HTMLElement>(".ez-reader__toc-row");
    rows.forEach((r) => {
      const id = r.getAttribute("data-toc-id");
      const dot = r.querySelector<HTMLElement>(".ez-reader__toc-progress-dot");
      if (!dot || !id) return;
      dot.removeClass("is-current", "is-visited", "is-unvisited");
      if (id === this.activeId) {
        dot.addClass("is-current");
      } else if (this.visitedIds.has(id)) {
        dot.addClass("is-visited");
      } else {
        dot.addClass("is-unvisited");
      }
    });
  }

  // ---- 键盘导航 ----

  /**
   * 键盘 handler — capture phase 挂在 panel root. 仅在 panel 可见 + 事件
   * target 在 panel 内 + 焦点不在 search input 时响应. ReaderView 的容器
   * 层快捷键 handler 在 capture 阶段先跑 (因为 containerEl 是 panel 的
   * 祖先), 它对箭头 / Enter 没路由, 不会冲突. Home/End/Space 在 ReaderView
   * 里有路由, 因此 bindKeyboardNavigation 在 tocPanel 可见时会跳过
   * target 在 panel 内的 action — 这里我们统一接管.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isVisible()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!this.root.contains(target)) return;
    // 焦点在 search input 时, 让浏览器自己处理输入 (Esc 清空 query 等).
    if (target instanceof HTMLInputElement && target.classList.contains("ez-reader__toc-search")) {
      if (event.key === "Escape") {
        // Esc 在 search input 里: 清空 query 并重新渲染 list.
        if (this.query) {
          target.value = "";
          this.query = "";
          this.searchExpanded = new Set();
          this.renderList();
          event.preventDefault();
          event.stopPropagation();
          // 让 ReaderView 也以为它处理过了, 不再 hideAllPanels
          // (panel 仍然可见, 用户没想关).
          return;
        }
        // 没 query 让 ReaderView 处理 Esc 关 panel.
        return;
      }
      return;
    }
    // 有修饰键的一律放过 — 让 Obsidian / 浏览器处理 (Ctrl+F 等).
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        this.moveFocus(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        this.moveFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        this.focusFirstOrLast(true);
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        this.focusFirstOrLast(false);
        return;
      case "ArrowRight":
        event.preventDefault();
        event.stopPropagation();
        this.handleArrowRight();
        return;
      case "ArrowLeft":
        event.preventDefault();
        event.stopPropagation();
        this.handleArrowLeft();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        this.activateFocused();
        return;
      case "Escape":
        // 让 ReaderView 统一处理 Esc 关 panel — 不 preventDefault, 让
        // ReaderView 在 capture 阶段跑完它的分支. 这里只需要清掉我们
        // 自己的焦点视觉 (panel 关掉后 is-hidden, applyFocusedClass 自
        // 然无操作).
        return;
    }
  }

  /** 拿到当前可见 row 列表 (按 DOM 顺序, 跳过 hidden). */
  private visibleRows(): HTMLElement[] {
    const all = Array.from(this.root.querySelectorAll<HTMLElement>(".ez-reader__toc-row"));
    return all.filter((r) => {
      // 检查 row 是否在折叠容器里 — collapsed 的 children 容器里的 row 不可见.
      let parent: HTMLElement | null = r.parentElement;
      while (parent && parent !== this.root) {
        if (parent.classList.contains("ez-reader__toc-children") && parent.classList.contains("is-collapsed")) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });
  }

  private firstVisibleRow(): HTMLElement | null {
    return this.visibleRows()[0] ?? null;
  }

  private lastVisibleRow(): HTMLElement | null {
    const rows = this.visibleRows();
    return rows[rows.length - 1] ?? null;
  }

  private moveFocus(delta: -1 | 1): void {
    const rows = this.visibleRows();
    if (rows.length === 0) return;
    const currentIdx = this.focusedId
      ? rows.findIndex((r) => r.getAttribute("data-toc-id") === this.focusedId)
      : -1;
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = delta > 0 ? 0 : rows.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + delta));
    }
    const nextRow = rows[nextIdx];
    if (!nextRow) return;
    this.focusedId = nextRow.getAttribute("data-toc-id");
    this.applyFocusedClass();
    try {
      nextRow.scrollIntoView({ block: "nearest" });
    } catch {
      /* noop */
    }
  }

  private focusFirstOrLast(first: boolean): void {
    const row = first ? this.firstVisibleRow() : this.lastVisibleRow();
    if (!row) return;
    this.focusedId = row.getAttribute("data-toc-id");
    this.applyFocusedClass();
    try {
      row.scrollIntoView({ block: "nearest" });
    } catch {
      /* noop */
    }
  }

  /**
   * → : 有子时折叠 (跟点 toggle 一致); 无子时跳到第一个子 (如果有, 通常
   * 叶子节点不会有 children, 但保险起见). 都做不到时什么都不做.
   */
  private handleArrowRight(): void {
    if (!this.focusedId) return;
    const row = this.root.querySelector<HTMLElement>(`.ez-reader__toc-row[data-toc-id="${this.focusedId}"]`);
    if (!row) return;
    if (row.classList.contains("is-parent")) {
      // 当前已展开 → 折叠; 折叠 → 展开.
      if (this.collapsed.has(this.focusedId)) {
        this.collapsed.delete(this.focusedId);
      } else {
        this.collapsed.add(this.focusedId);
        // 用户主动折叠同样覆盖 searchExpanded 的"激活章节展开".
        this.searchExpanded.delete(this.focusedId);
      }
      this.refreshActiveAndCollapseStyles();
    }
    // 叶子节点 / 单层节点: 没动作.
  }

  /**
   * ← : 有子且展开时折叠 (相当于 toggle); 否则跳到父 (fold-able) 或不做.
   * 实现: 如果当前 row 处于展开状态 → 折叠. 如果已折叠或叶子 → 找父.
   */
  private handleArrowLeft(): void {
    if (!this.focusedId) return;
    const row = this.root.querySelector<HTMLElement>(`.ez-reader__toc-row[data-toc-id="${this.focusedId}"]`);
    if (!row) return;
    if (row.classList.contains("is-parent") && !this.collapsed.has(this.focusedId)) {
      this.collapsed.add(this.focusedId);
      // searchExpanded 是 "active 章节祖先展开" 的临时机制, 用户主动
      // 折叠应覆盖之 — 否则 is-collapsed 视觉出不来.
      this.searchExpanded.delete(this.focusedId);
      this.refreshActiveAndCollapseStyles();
      return;
    }
    // 找父 row — 在 DOM 树里, 当前 row 的最近 .ez-reader__toc-children
    // 容器的 data-toc-children-of 就是父 id.
    let parent: HTMLElement | null = row.parentElement;
    while (parent && parent !== this.root) {
      if (parent.classList.contains("ez-reader__toc-children")) {
        const parentId = parent.getAttribute("data-toc-children-of");
        if (parentId) {
          this.focusedId = parentId;
          this.applyFocusedClass();
          const parentRow = this.root.querySelector<HTMLElement>(
            `.ez-reader__toc-row[data-toc-id="${parentId}"]`
          );
          if (parentRow) {
            try {
              parentRow.scrollIntoView({ block: "nearest" });
            } catch {
              /* noop */
            }
          }
        }
        return;
      }
      parent = parent.parentElement;
    }
  }

  private activateFocused(): void {
    if (!this.focusedId) return;
    const item = this.findItemById(this.focusedId);
    if (!item) return;
    this.handlers.onJump(item);
  }

  private findItemById(id: string): TocItem | null {
    return this.findNodeById(this.tree, id)?.item ?? null;
  }

  private applyFocusedClass(): void {
    const rows = this.root.querySelectorAll<HTMLElement>(".ez-reader__toc-row");
    rows.forEach((r) => {
      r.toggleClass("is-focused", r.getAttribute("data-toc-id") === this.focusedId);
    });
  }
}