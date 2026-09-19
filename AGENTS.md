# AGENTS.md — EzReader 项目交接文档

> 这是给下一个接手的 AI agent / 开发者看的。**先读完 TL;DR 和"当前未解决问题"**,再决定深入读哪一节。

---

## TL;DR

**项目**: Obsidian 社区市场插件 `ez-reader`(从零重写,非 fork)。
**位置**: `/home/ljl/dsh/ezreader/`
**远程仓库**: `git@github.com:alei37/ez-reader.git`,分支 `main`
**当前 HEAD**: `75b69c0` — "chore: 删 15 个 unused index.ts barrel 文件"
**测试/部署路径**: `/home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/`
**架构**: 分层端口-适配器(Port/Adapter) + 严格 core/adapters/ui 分层。
**支持格式**:
| 格式 | 状态 | 适配器 |
|------|------|--------|
| EPUB | ✅ 完整 | `FoliateBookReader` (foliate-js 1.0.1) |
| PDF | ✅ 完整 | **Obsidian 内置 PDFViewer** + 自建 `PdfOverlay` |
| TXT | ✅ 完整 | `TxtBookReader` + `PagedTextSession` |
| MOBI | ✅ 完整 | `MobiBookReader` (`@lingo-reader/mobi-parser`) |
| AZW3 | ✅ 完整 | 同 MOBI(`createParser` 内部走 `initKf8File`) |

**关键风险点**:
1. **PDF 体验依赖 Obsidian 内置 PDFView**。如果用户的 PDF 用了第三方接管(如 PDF++),`PdfOverlay` 挂不上 → 跳页走 fallback `setEphemeralState`。某些 PDF 插件会改 DOM 结构。
2. **MOBI 在大文件时** `createParser` 可能要 2-5s(同步解压)。P1 polish 已标,未修。
3. **Android 端未测**。Syncthing 排除 `.obsidian/`,插件代码会同步,数据不会。移动端 foliate iframe 行为可能有差异。

---

## 1. 用户是谁,要做什么

### 用户信息
- **GitHub**: `alei37`(EzReader 由其从零开发)
- **使用设备**: Linux 桌面 + Android 平板(Syncthing 同步 vault)
- **Obsidian vault**: `/home/ljl/obsidian/obsidian_alei/`
- **语言**: 中文(代码注释混合中英文)
- **沟通风格**: 直接、不废话,经常只发一两句需求,需要你主动问细节。**偏好用代码示例和测试结果说话**。

### 产品愿景
**个人书架 / 书库**(Goodreads 风格):
1. 用户手动从 vault 导入书籍 → 出现在书架
2. 书架可筛选 / 排序 / 置顶
3. 点击封面 → 进入阅读器
4. 阅读器:选词翻译/摘录/想法,进度自动保存,笔记双链

**对标体验**:微信读书。字号/行距/主题切换、翻页动画、触摸翻页、选词操作。

---

## 2. 项目基础信息

### 文件结构
```
/home/ljl/dsh/ezreader/
├── AGENTS.md                ← 你正在读
├── README.md                ← 用户面向文档 (中文)
├── PRIVACY.md
├── manifest.json            ← plugin id: "ez-reader", version 0.2.0, mobile OK
├── package.json             ← pnpm 11.9.0, Node >= 22.13, esbuild
├── pnpm-workspace.yaml      ← pnpm workspace (单包)
├── esbuild.config.mjs       ← 主构建 (src/main.ts → main.js)
├── esbuild.tests.config.mjs ← 测试构建
├── tsconfig.json
├── patches/
│   └── foliate-js@1.0.1.patch  ← 移除 allow-scripts + customElements guard
├── LICENSES/
│   └── obsidian-pdf-plus-MIT.txt  ← P0 修复时参考的 PDF 解析库
├── dist/                    ← CI 发布的预构建 (manifest.json + styles.css)
├── reports/                 ← 历史研究文档
│   └── sunny-research-report.md  ← 项目早期研究笔记(过时但有 context)
├── main.js                  ← 构建产物 (~929 KB, gitignored)
├── styles.css               ← 全部样式 (~77 KB)
├── tests/
│   ├── core/                ← 单元测试 (Node --test) — 29 个 .test.ts 文件
│   │   ├── stubs/obsidian-stub.mjs  ← obsidian types-only 的 stub + DOM helper install
│   │   └── *.test.ts
│   └── dist/core/           ← 测试 bundle (esbuild 产物)
└── src/
    ├── main.ts              ← 入口
    ├── Plugin.ts            ← Obsidian 插件主类,装配所有依赖
    ├── core/                ← 零 Obsidian 依赖的纯逻辑
    │   ├── entities/        ← Book, Bookmark, Excerpt, ReadingState
    │   ├── ports/           ← BookReader, BookSource, AnnotationStore, NoteWriter, TranslationProvider
    │   ├── services/        ← LibraryService, ReadingService, TranslationService
    │   ├── pdf/             ← PDF highlight 纯函数
    │   ├── types/           ← ShelfFilter, ReaderSettings (ReaderAppearance)
    │   └── utils/           ← Disposable
    ├── adapters/            ← Obsidian + 第三方实现
    │   ├── obsidian/        ← ObsidianBookSource, ObsidianAnnotationStore, ObsidianNoteWriter, CoverCache
    │   ├── foliate/         ← FoliateBookReader (EPUB)
    │   ├── text/            ← TxtBookReader, MobiBookReader, PagedTextSession (共享)
    │   └── translation/     ← Youdao/Deepl/Google providers
    └── ui/                  ← 渲染层
        ├── reader/          ← ReaderView, ReaderToolbar, ReaderSelectionMenu, 各种 panel/modal
        ├── shelf/           ← ShelfView, ShelfToolbar, ShelfFilters, AddToLibraryModal, OnboardingModal
        └── settings/        ← SettingsTab
```

### 关键元数据
- **plugin id**: `ez-reader` (manifest.json + Plugin 装配用)
- **minAppVersion**: `1.12.7`
- **isDesktopOnly**: `false` (移动端 OK)
- **version**: `0.2.0` (release prep commit `63c071b` 已 bump)

---

## 3. 架构关键决策(硬规则)

### 3.1 分层
```
core/  (纯逻辑,无 Obsidian import)
   ↑
adapters/  (Obsidian API + foliate + pdfjs 的具体实现)
   ↑
ui/  (DOM 渲染、用户交互)
   ↑
Plugin.ts  (装配)
```

**写代码时硬规则**:
- `core/` 永远不能 `import "obsidian"`
- `core/ports/*` 是接口,实现必须在 `adapters/`
- 测试可以 mock port 接口,无需启动 Obsidian

### 3.2 Obsidian API 关键事实
- `removeClass(...classes: string[])` 是 variadic,**不要**传数组
- `vault.adapter.list(path)` 返回 `files: string[]` 是 **vault 相对全路径**,不要再拼 `path`
- `vault.getAbstractFileByPath(".obsidian/...")` 在 Linux 会拒绝,**跳过它**(hydrateCovers 用 filePath.split("/").pop())
- `adapter.getResourcePath(filePath)` 返回 `app://<hash>/<path>?<token>`,token 是 session-scoped,**必须每次启动重新生成**
- `isDesktopOnly: false` — 必须考虑移动端 WebView 兼容性

### 3.3 ⚠️ esbuild `external` 陷阱
- 静态 `import "obsidian"` 走 `external: ["obsidian"]` → bundle 时保留 specifier → Obsidian runtime 提供
- **动态 `import("obsidian")` 不走 external**!esbuild 把它当普通 module specifier,Obsidian runtime 找不到 → throw `Failed to resolve module specifier 'obsidian'`
- **修复**:永远用顶层 `import { ... } from "obsidian"`,不要 `await import("obsidian")`
- 这条规则在 `commit 876243c` 已经全部修过, `commit 3a4de46` 继续守住。`grep "await import(.obsidian.)" src/` 应该 0 命中。

### 3.4 文件 IO 模式
- 通过依赖注入 `BookBytesLoader`,**不要在 reader 里用 `fetch()`**(`obsidian://` 协议 fetch 不可用)
- `Plugin.makeBookBytesLoader()` 已经在 `Plugin.ts` 装配:
  ```ts
  const bookBytesLoader: BookBytesLoader = async (path) => {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error(`Book file not found: ${path}`);
    return this.app.vault.readBinary(file);
  };
  ```

### 3.5 BookReader 接口
`src/core/ports/BookReader.ts` 的 `BookReader` 接口:
- `open(book, host, appearance, loader) → ReaderSession`
- `extractCover(book, loader) → ExtractedCover | null`

`ReaderSession` 接口关键方法:
- `goTo(target)` / `currentFraction()` / `exportLocator()`
- `on(event, handler)` — 主要是 `"relocate"` 和 `"selection-change"`
- `close()` / `applyAppearance(appearance)`
- `setOnIframeKeydown?(handler)` — foliate 用,把 iframe 内的 keydown 转发给 ReaderView
- `highlight?(spec)` / `removeHighlight?(id)` / `listHighlights?()` — 高亮 API
- `currentChapter?()` / `tableOfContents?()` / `goToToc?(id)` — TOC API
- `currentPage?()` / `totalPages?()` — 页码信息

### 3.6 资源持久化
- 封面缓存: `<Vault>/.obsidian/plugins/ez-reader/data/covers/`
- 路径映射: `data.json` 内的 `coverPaths` 字段(AnnotationSnapshot)
- `CoverCache.writeCover` **直接覆盖** vault adapter.writeBinary,不用临时文件
- `CoverCache.hydrateCovers` 在 `onLayoutReady` 之后串行调用,**跳过 `.obsidian/` 路径**

---

## 4. 格式适配器详情

### 4.1 EPUB (`FoliateBookReader`)
- 依赖: `foliate-js@1.0.1` (patched in `patches/`)
- patch 内容: 移除 `package.json` 的 `allow-scripts`(esbuild 不识别) + 加 `customElements.get` guard(避免重复注册)
- 路由: `src/Plugin.ts:73` 直接 `this.foliate = new FoliateBookReader()`
- 创建 `<foliate-view>` custom element 挂到 host
- **关键修复** (`commit 876243c` + `commit 3a4de46`):
  - iframe.contentDocument 监听 keydown 转发给 ReaderView(键盘左右键 work)
  - `commit 3a4de46` patch foliate-js 直接 inline `@import "blob:..."` 和 `<link rel=stylesheet>` (mutation observer 来不及拦截, microtask vs sync parse race)
  - `commit 3a4de46` patch 删 `<script>` / 嵌套 `<iframe>` / `on*` / `javascript:` URL(绕 sandboxed iframe 没 allow-scripts 报错)
  - `setOnIframeKeydown` 暴露给 ReaderView

### 4.2 PDF (`PdfOverlay` on Obsidian PDFView)
- **不再自渲染 PDF**(删了 719 行 PdfjsBookReader)
- `Plugin.openInBuiltInViewer` 调 `app.workspace.openLinkText(file.path, "", true)` (新 tab,不分屏)
- 等 PDF leaf 出现后挂 `PdfOverlay`:
  - 选词菜单(翻译/摘录/想法/复制)
  - 黄条 highlight 回显(rAF 60fps 监测 getBoundingClientRect)
  - 笔记侧边栏(摘录 + 书签列表)
- `handleProtocol` 按 format 路由:PDF 走 `overlay.jumpToExcerpt`,其他走 `ReaderView.openExcerptById`
- Fallback:overlay 没挂上时用 `setEphemeralState({url: '#page=N'})` 或 `openLinkText("path#page=N")`

### 4.3 TXT (`TxtBookReader` + `PagedTextSession`)
- 零依赖,纯 DOM 渲染
- `decodeText(bytes)` — BOM 剥离 + strict UTF-8 → GB18030 → permissive UTF-8
- `splitTextIntoPages(text)` — 段落感知分页(`DEFAULT_PAGE_CHARS = 1600`, `MAX_PAGE_CHARS = 2400`)
- `guessTitleFromText` — 第一行 ≤80 字符且不以 `.` `。` 结尾(中文古文可能误判,P1 polish)
- `PagedTextSession` 渲染一页到 host,翻页替换内容
- **P0 修复**:`applyHighlightOverlay` 不用 `range.surroundContents`(跨元素 throw),改 walk text nodes + 反向迭代 wrap `<mark>`

### 4.4 MOBI/AZW3 (`MobiBookReader`)
- 依赖: `@lingo-reader/mobi-parser@0.4.6` + `fflate@0.8.3` + `@lingo-reader/shared@0.4.6`
- `createParser(format, bytes)` — 走 `initMobiFile`(old MOBI)或 `initKf8File`(AZW3)
- `buildContent(parser, book)` 现在是 `async` — 同步 `loadChapter` + 异步 fetch 每章 CSS blob URL 转 text(绕过 Obsidian CSP)
- `PagedTextSession` 复用(跟 TXT 共用),但 `PagedTextPage.css` 字段从 `{id, href}` 改成 `{id, text}`(inline CSS 字符串)
- **P0 修复**:try/catch 包 `buildContent`,失败时 `parser.destroy()` 避免 blob URL 泄漏;`view.open` 后 patch `session.close` 调用 `parser.destroy()` 释放资源

### 4.5 适配器注册 (`Plugin.makeTextReader`)
```ts
private makeTextReader(): BookReader {
  return {
    open: async (book, host, appearance, loader) => {
      if (book.locator.format === "mobi" || book.locator.format === "azw3") {
        return this.mobiReader.open(book, host, appearance, loader);
      }
      return this.txtReader.open(book, host, appearance, loader);
    },
    extractCover: ...
  };
}
```

---

## 5. 关键文件指针

| 文件 | 作用 | 何时改 |
|------|------|--------|
| `src/Plugin.ts` | Obsidian 主类,装配所有依赖 | 加新服务、改 ribbon、改 settings 项 |
| `src/adapters/obsidian/CoverCache.ts` | 封面缓存持久化 + extractCover 路由 | 改封面逻辑、新增格式支持 |
| `src/adapters/obsidian/ObsidianAnnotationStore.ts` | data.json 持久化 + writeChain 串行化 | 加新字段(像 `pinnedAtByBookId`)、改 schema |
| `src/adapters/obsidian/ObsidianNoteWriter.ts` | 摘录/想法的 vault md 同步 | 改 markdown 模板、加双链 |
| `src/adapters/text/PagedTextSession.ts` | TXT + MOBI 共享的页面渲染 | 改翻页/选词/highlight |
| `src/adapters/foliate/FoliateBookReader.ts` | EPUB foliate-js 封装 | 改 EPUB 行为、iframe 事件转发 |
| `src/ui/reader/pdfOverlay.ts` | ~1200 行,PDF 选词/黄条/笔记侧边栏 | 改 PDF 体验,加 thought/highlight 功能 |
| `src/ui/reader/ReaderView.ts` | ~1900 行,阅读器主视图 (含 tocMarkers / quick* / chapter 同步) | 加阅读器功能、改键盘/手势/沉浸 |
| `src/ui/reader/ReaderToolbar.ts` | 工具栏 (最左目录 icon,最右 close icon) + 章节标记条 | 改工具栏布局/按钮 |
| `src/ui/reader/ReaderSelectionMenu.ts` | 选词浮层菜单(想法/摘录/翻译/复制) + 快捷键小字提示 | 改菜单位置/快捷键 |
| `src/ui/reader/ShortcutHelpModal.ts` | `?` 弹出的快捷键分组表格 modal | 改快捷键列表 |
| `src/ui/reader/readerShortcuts.ts` | 纯函数键盘路由 (含 quickHighlight / quickBookmark) | 加/改快捷键 |
| `src/ui/reader/BookmarksPanel.ts` | 书签面板 (chapter+%+时间上下文,jump+remove 共一行) | 改书签 UX |
| `src/ui/reader/ExcerptsPanel.ts` | 摘录面板卡片式 (chapter+quote+note+tags+动作) | 改摘录 UX |
| `src/ui/reader/SidebarNotesPanel.ts` | 笔记侧栏 (tabs 全部/想法/摘录 + inline note 编辑) | 改笔记 UX |
| `src/ui/reader/TranslationDrawer.ts` | 翻译抽屉 (max-height 50vh + copy 按钮) | 改翻译 UX |
| `src/ui/shelf/ShelfView.ts` | 书架主视图 + 右键菜单 | 改书架布局、增右键菜单项 |
| `src/ui/shelf/AddToLibraryModal.ts` | 加入书籍弹窗,选书界面 | 改批量加入流程 |
| `src/core/services/LibraryService.ts` | ~500 行,library 状态管理 | 加新书操作、改排序/筛选 |
| `src/core/services/ReadingService.ts` | ~160 行,reading/highlight/annotation 状态 + `updateExcerptNote` patch API | 加 annotation 类型 |
| `src/core/entities/Book.ts` | Book interface | 加新字段(像 `pinnedAt`) |
| `src/core/ports/BookReader.ts` | BookReader/ReaderSession 接口 | 加 reader 能力(zoom/highlight) |
| `src/core/ports/AnnotationStore.ts` | 持久化接口 (含 `updateExcerptNote`) | 加新 store 方法 |
| `tests/stubs/obsidian-stub.mjs` | obsidian types-only stub + `installObsidianDomHelpers(HTMLElement)` | 加新 UI 测试时复用 |
| `styles.css` | 全部样式 (~77 KB) | 任何视觉调整 |
| `manifest.json` | 插件元数据 | 改版本、minAppVersion |
| `esbuild.config.mjs` | 主构建 | 加新 worker/loader |

---

## 6. 构建 / 测试 / 部署

### 6.1 构建
```bash
cd /home/ljl/dsh/ezreader
pnpm install          # 第一次或依赖变了
pnpm run build        # 产出 main.js (~929 KB)
```

`pnpm run build` = `tsc --noEmit --skipLibCheck && node esbuild.config.mjs production`

### 6.2 测试
```bash
pnpm test
```

= `node esbuild.tests.config.mjs && node --test tests/dist/core/*.test.mjs`

**测试在 `tests/core/` 下,只测 `core/` 里的服务, 不启动 Obsidian**。

**当前**: 307/307 通过 (29 个 .test.ts,涵盖 core + ui panel/styling)

**测试 bundle ESM/CJS interop**:
- `esbuild.tests.config.mjs` externalize `obsidian`, `jsdom`, 和 Node built-ins (`path`, `fs`, `url`, `os`, `crypto`, `stream`, `buffer`, `util`, `events`, `assert`, `child_process`)
- jsdom 走 `import { JSDOM } from "jsdom"`,在测试里手动 copy DOM globals 到 globalThis

**测试常见 mock 需求**:
- `loadCoverPaths` / `saveCoverPaths` 在 stub 里实现为内存 Map
- `BookReader` stub 提供 `open` 返回 fake session(需要时 mock `setOnIframeKeydown`)

### 6.3 部署到桌面 vault
```bash
cd /home/ljl/dsh/ezreader
pnpm run build
cp main.js styles.css manifest.json /home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/
```

### 6.4 部署到 Android
- 用户手动用 Syncthing 同步整个 vault
- 因为 `.obsidian/` 被排除,需要用户手动 `adb push` 或 git pull 后复制
- 或者告诉用户先在桌面仓库 build,然后让插件代码自然同步

### 6.5 热重载
Obsidian 桌面版支持插件热重载(在设置里打开),改了代码后:
1. `pnpm run build`
2. Obsidian 里 `Ctrl/Cmd + P` → "Reload app without saving"
3. 不用完全退出

但用户经常要求**完全退出重启**(尤其测试 PDF 这种)。

---

## 7. 已知 P1/P2 polish 项(不阻塞,留作下一轮)

> 同步到 commit `75b69c0` (2026-09-19,chore: 删 15 个 unused index.ts barrel 文件)。最近三轮修了:
> - **v5 TocPanel**(commit `87e3194`,详见 §12)— 键盘导航 + 自动滚到当前章节 + 面包屑 + 章节计数 chip + 搜索高亮 + 进度点 (visited/current/unvisited)
> - **v6 TocPanel**(commit `a67aa9c`,详见 §13)— header 两行重排 + 加宽 320→380px + 缩进竖线修复 + visited 持久化 (AnnotationSnapshot.visitedTocIdsByBookId)
> - **UX v3**(commit `846de91`,详见 §11)— 8 项 P2 reader 优化 + 6 项 P1 反馈轮 + 红 badge 改灰 + EPUB chapter 实时同步
> - **TOC 移到 body 最左**(commit `442feb7`)— 之前在 stage 右边变成最右, 现在 flex row 永远是 [toc] [notes] [stage]
> - **cleanup**(commit `75b69c0`,详见 §14)— 删 15 个 dead barrel 文件

### P1(用户体验)
- **MOBI 大文件 parser 阻塞主线程** — 2-5s 同步解压,UI 假死(需要 Web Worker 化)
- **跨页摘录不支持** — TXT/MOBI 单页渲染, 浏览器 selection 只在可见 DOM
- **PDF selection-level jump 不精确** — `PdfOverlay.jumpToExcerpt` 只 scrollIntoView 到 page, 缺 4-tuple subpath (需要 PDFView 暴露内部 API; P2-5 TODO 在 `pdfOverlay.ts:445`, **user 已确认留作 follow-up**)

### P2(代码质量)
- **CI/release workflow** — 没 `.github/workflows/release.yml` 自动打 zip
- **Manifest description / README 截图** — 准备 public release 前可补
- **`buildAppearanceCss` / `buildPagedTextCss` 还存在** — 共享 `themeColors` 已拆, 但 buildAppearanceCss / buildPagedTextCss 各自仍有颜色变量重复, 进一步可统一

### 已知用户体验细节
- 用户偏好中文 UI(label 用中文:`想法`、`摘录`、`翻译`、`复制`)
- Obsidian ribbon 槽位宝贵 — 不要加不必要的 ribbon 按钮
- Toolbar 不用汉字,全部 lucide icon(`setIcon` from obsidian)
- 工具栏布局:**最左目录 icon,最右 close icon**,中间 status pill + 收藏 + 导航 + 字号/笔记/沉浸
- 沉浸模式隐藏 toolbar,必须留一个**永远可见的 × 按钮**(`ez-reader__immersive-exit`)给用户退出

---

## 8. 调试技巧

### 8.1 打开 Obsidian Console
- Linux: `View → Toggle Developer Tools → Console`
- 命令行: `obsidian --enable-logging`(默认就有)

### 8.2 关键日志(已知的 ours)
- `[ez-reader] failed to open book` — engine.open 失败(看 message)
- `[ez-reader] PDF cover extracted` / `PDF cover extraction failed`
- `[ez-reader] confirmSelection timed out after 30000ms` — modal.confirmSelection 30s 兜底超时
- `[ez-reader] extractCover(...) exceeded 15000ms — abandoning` — 单书 extractCover 15s 超时
- `[ez-reader] mobi parser destroy failed` — MOBI 资源释放出错
- `[ez-reader] hydrateCovers: no matching book for slug: <slug> (orphan, ignored)` — orphan cover(无害,info 级别)
- `[ez-reader] addToLibrary 超时` / `extractCoversFor 超时` — raceWithTimeout 兜底
- `[ez-reader] handleProtocol: PdfOverlay not found for <bookId>` — PDF++ 等干扰导致 overlay 没挂上
- `[ez-reader] shelf addAllToLibrary timed out after 90000ms`

### 8.3 已知外部报错
- **`Refused to load the stylesheet 'blob:...'`** — Obsidian CSP 拒绝 blob: 源 stylesheet。**我们代码已经全部修掉**(EPUB iframe 内 MutationObserver,MOBI 章节 CSS fetch 转 inline)。如果 console 还有这个错,**不是我们**导致的,是其他插件(excalidraw、PDF++、omnisearch)。
- **`net::ERR_CONNECTION_CLOSED` from `plugin:pdf-plus`** — PDF++ 自己资源加载失败,跟我们无关。但**会让 PdfOverlay 挂不上**(PDF++ 接管后改了 DOM 结构,我们 querySelector 选不到 .pdf-viewer)。fallback 会走 `setEphemeralState`/`openLinkText("#page=N")`。
- **`Failed to resolve module specifier 'obsidian'`** — **永远不应该再出现**!这是 esbuild dynamic import 没 externalize 的错误。`grep "await import(.obsidian.)" src/` 应该 0 命中。如果出现就是有人引入新代码,立即修。

### 8.4 测试 PDF 位置
`/home/ljl/obsidian/obsidian_alei/04-resources/books/` 下有:
- `地震学导论 (万永革) (Z-Library).pdf`
- `离散时间信号处理 第3版 (...).pdf`
- `数字信号处理的MATLAB实现 (...).pdf`
- `Introduction to Seismology (Peter M. Shearer) (Z.epub`
- `sample-text.txt`

### 8.5 Cannot reproduce in Node
PDF 渲染 / foliate iframe / canvas / Shadow DOM 在 JSDOM 里都跑不起来。
**只能用 Obsidian runtime 验证**。改完必须让用户在 Obsidian 里测试。

---

## 9. Git workflow

### 9.1 Commit 风格
历史 commit message 都是中文前缀 + 英文说明,例:
```
feat(reader): PDF 走 Obsidian 自带 PDFViewer, 自己不写
fix(pdf): 用 inline style 强制 wrapper 居中
feat: TXT/MOBI reader + PDF 跳转 + 沉浸/panel fix + 置顶功能
```

**格式**: `<type>(<scope>): <中文简短描述>` 或 `<type>: <中文简短描述>`
**type**: `fix` / `feat` / `style` / `refactor` / `test` / `docs` / `chore`

### 9.2 工作流
- 本地改完 build + 部署 → 让用户测试 → 用户确认 OK 后再 `git add . && git commit && git push`
- **不要 force push**(远程 main 分支保护)
- 远程是 SSH `git@github.com:alei37/ez-reader.git`(不是 HTTPS)
- 作者信息: `ljl <2114591501@qq.com>`

### 9.3 Commit 时常见文件
- 改了 UI → 必须 `pnpm run build` 后 commit 新的 `main.js` + `styles.css`
- 改了测试 → 跑 `pnpm test` 全通过再 commit
- `dist/manifest.json` 和 `dist/styles.css` 是给"手动 zip 安装"用户的预构建(平时不动)
  - 但 release 前**应当**用单独的 `chore: refresh dist/` commit 把它们 sync 到当前 HEAD
  - GitHub Actions release workflow 不动 `dist/` — workflow 直接从 build 后的 `main.js` + `manifest.json` + `styles.css` 打 zip

---

## 10. 一句话总结

这是一个**从零重写的 Obsidian 阅读器插件**,核心是用分层架构支持 EPUB + PDF + TXT + MOBI/AZW3,正在打磨阅读器体验对标微信读书。**重点是 esbuild `await import("obsidian")` 陷阱、Obsidian PDFView DOM 兼容性、CSP blob: 拒绝**这三类坑;**改完一定要 `pnpm run build` + 部署 + 让用户在 Obsidian 真实环境测试**。

---

## 11. Reader UX v3 详解 (commit `846de91`)

> 这一轮目标是 **减少 modal 打断、加快注释流**,对标微信读书 / Apple Books 的"一键 + 上下文可见"。

### 11.1 Quick actions (无 modal)

| 快捷键 | 行为 | 实现位置 |
|---|---|---|
| `H` (裸) | quickHighlight — 选词后直接保存摘录 + 黄色高亮 | `ReaderView.quickHighlight` → `saveExcerptCore(text, "", [], quick=true)` |
| `B` (裸) | quickBookmark — 一键加书签, label = `chapter · %` | `ReaderView.quickBookmark` → `composeQuickBookmarkLabel(chapter, fraction)` |
| `Shift+H` | excerpt (modal) — 保留原有弹出 note + tags 输入的流程 | `ReaderView.saveExcerptFromSelection` |

**设计动机**: 微信读书 / Apple Books / Readwise 的"加书签/高亮"都是一键, modal 流打断阅读流. v3 把这两个高频动作降到单键, modal 流仍保留作为 `Shift+H` 路径.

### 11.2 Selection menu 快捷键提示

`ReaderSelectionMenu` 构造时接受 `hints?: { thought, excerpt, translate, copy }`. 按钮渲染时把快捷键作为小字 hint (`.ez-reader__selection-menu__hint`) 显示在主 label 下方 — 用户不按 `?` 也能发现快捷键. CSS 媒体查询 `< 500px` 自动隐藏 hint (移动端 popover 挤不下).

ReaderView 注入的 hints:
- `想法`: `Shift+T`
- `摘录`: `Shift+H`
- `翻译`: `undefined` (翻译直接走 Shift+T 重叠, 不显示)
- `复制`: `C`

### 11.3 ShortcutHelpModal (`?` 键)

`src/ui/reader/ShortcutHelpModal.ts` — `?` 按下时弹出的分组表格 modal. 替代之前 `Notice` 长文本 (被截断 + 自动消失).

分组: 翻页 / 注释 — 一键保存 / 注释 — 翻译 / 复制 / 面板 / 沉浸 / 搜索 / 其它. 每个键用 `<kbd>` 标签呈现, Esc 关闭.

底部 footer 显示用户当前的 `prev / next / sidebar / toc / translate / highlight` 实际绑定 — 一眼看出"我改过没".

### 11.4 Inline note 编辑 (核心 UX)

**问题**: SidebarNotesPanel 之前只能通过 ✎ 按钮打开 modal 改 note, 用户路径太长.

**P2 方案**:
- `SidebarNotesHandlers.onUpdateNote?: (excerpt, note) => Promise<void>` — 新增 handler
- 点 ▸ 展开 → **自动进 contenteditable** (`data-editing="1"` sentinel 标志, 避开 jsdom 不支持的 `isContentEditable`)
- blur / Cmd+Enter / **再点 ▸ 收起** → 自动 commit (调 `onUpdateNote`)
- Esc → 还原原文字 (cancel)
- 失败 → 回滚 DOM textContent 到原 note, console.warn

**数据层新增 API**:
```ts
// AnnotationStore
updateExcerptNote(bookId, excerptId, patch: { note?, tags? }): Promise<void>

// ReadingService — 同上包装
updateExcerptNote(bookId, excerptId, patch)

// ReaderView
updateExcerptNoteInline(excerpt, note): Promise<void>  // 包装给 UI
editExcerpt: 改用 patch 路径 (原 remove+add 太重, 现在不重写 highlight)
```

### 11.5 Notes panel tabs

`SidebarNotesPanel.typeFilter: "all" | "thought" | "excerpt"`. 顶部 [全部 / 想法 / 摘录] tab 一对一, 每个 tab 带 count chip.

- thought = `!excerpt.text?.trim()` (openFreeThoughtModal 创建的)
- excerpt = `!!excerpt.text?.trim()` (选词保存的)

数量无论多少都显示 tabs (不像搜索框 ≥5 条才显示).

### 11.6 TranslationDrawer 改进

- `max-height: 50vh` — 长译文不再撑出屏幕, body 内部 `overflow-y: auto`
- 新增 `onCopy?: (translation) => Promise<void> | void` handler
- "复制" 按钮 — 复制成功后短暂变 "✓ 已复制" (1.5s 后还原)

ReaderView 注入 `onCopy: copyTextToClipboard` (复用 selection menu 同一 `navigator.clipboard.writeText` 路径).

### 11.7 章节标记条 (chapter markers)

`ReaderToolbar.tocMarkersBar` — 进度条正下方一行 (高度 6px, max-width 320px). 每个点对应一个 toc item 的 fraction 位置.

**被动记录机制**:
- `ReaderView.tocFractions: Map<id, number>` — 滚动过程中 relocate handler 拿到 chapter label → 在 tocItems 里找匹配 id → 写 `(id, fraction)`. **只在第一次记录** (Map.has 检查).
- `toolbarState()` 把 tocFractions + tocItems 拼成 `{ id, label, fraction }[]` 传给 toolbar.
- `updateTocMarkers()` 用 inline style `left: ${frac * 100}%` 渲染小圆点.

**交互**:
- Hover → 圆点变 1.4x + 主题色 (Obsidian `--interactive-accent`)
- Click → `onJumpToc(id)` → `ReaderView.jumpToTocById(id)` → `session.goToToc(id)`
- 0% / 100% 端点跳过 (跟 slider 端点重合)
- 没 markers 时容器 `is-empty` class → `height: 0`, 不占空间

**注意**: 第一次打开书时 markers 为空, 用户滚几屏后才出现. 这是设计权衡 — 主动 seek 探测所有 toc item 会有性能成本 + 闪烁. 被动方案自然稳定.

### 11.8 Toolbar 红 badge 改灰

`.ez-reader__reader-toolbar__badge` 之前用 `var(--color-red, var(--interactive-accent))` 红底 + 白字 — 用户说"像待办". 改用 `var(--background-modifier-border, var(--background-modifier-hover))` 灰底 + `var(--text-muted)` 灰字. 不再像 unread badge.

### 11.9 书签面板 UX (P1 反馈轮)

- jump 按钮和 × 删除按钮**同一行** (`.ez-reader__bookmark-row__action-row`), 之前 remove 单独占一行, 浪费纵向空间.
- chapter / % / 时间上下文显示 (context-line 在 action-row 之上)
- 空 chapter 的旧书签: 只渲染 % 和时间, 不渲染空 `<span class="...__chapter">` 避免空白 chip.

### 11.10 摘录面板 UX (P1 反馈轮)

- 卡片式: chapter + 时间 → 原文 blockquote (浅灰底 + 蓝边) → note (浅黄底, 有 note 时) → tags → jump/delete 按钮
- 自由想法 (`text === ""`, "+想法" 走 `openFreeThoughtModal` 创建的): 不渲染空 blockquote, 显示 `💭 自由想法` badge (斜体浅黄)

### 11.11 EPUB 选词 menu 修复 (P1 反馈轮)

`FoliateBookReader.bindSelectionChange.attach` 在原 `selectionchange` 之上加 `mouseup` / `pointerup` / `touchend` 三重兜底 — foliate 沙盒 iframe (`sandbox="allow-same-origin"`) 内 selectionchange 不可靠, 加上 pointer/touch 事件覆盖桌面 + 移动端.

### 11.12 NotesPanel / BookmarksPanel / ExcerptsPanel header × 按钮 (P1 反馈轮)

所有 reader panel header 现在统一有 × 按钮 (mobile / narrow layout). Esc 键也走同一条 `hideAllPanels` 路径 — 之前只关 tocPanel, 三个其他 panel Esc 没反应.

### 11.13 测试基础设施

新加 `tests/stubs/obsidian-stub.mjs`:
- obsidian 是 types-only (`@types/obsidian` 不会出现在运行时)
- esbuild alias: `"obsidian" → stubPath` (绝对路径 via `fileURLToPath`)
- stub 导出 `Modal`, `App`, `Plugin`, `Setting`, `Notice`, `Platform`, `setIcon`, `setTooltip`, `default`
- 关键导出 `installObsidianDomHelpers(HTMLElementCtor)` — 把 Obsidian 风格的 `createDiv`/`createEl`/`createSpan`/`empty`/`addClass`/`removeClass`/`toggleClass`/`setText` 工厂方法 patch 到给定构造函数的 prototype
- jsdom 每个实例有独立的 `HTMLElement.prototype`, stub **不在加载时污染 globalThis.HTMLElement**, 而是让测试在 setup 后显式调 `installObsidianDomHelpers(globalThis.HTMLElement)`
- 经验: jsdom 的 `note.isContentEditable` 是 undefined (contentEditable 属性不可观察), 用自己的 `data-editing="1"` sentinel 标志

新加 `tests/core/ReaderPanelPolish.test.ts` — 15 个测试, 涵盖:
- BookmarksPanel: chapter/%/时间渲染 / 排序 / action-row / 旧书签兼容
- ExcerptsPanel: 卡片 / quote/note/tags 渲染 / thought badge (空 text 退化)
- SidebarNotesPanel: × close button / tabs / inline note patch / tab filter

---

## 12. TocPanel v5 详解 (commit `87e3194`)

> 这一轮把目录面板从"只支持鼠标点击"升级到"键盘 + 自动滚动 + 进度可视化",对标 Obsidian 自带 outline panel 的体感. 文件 `src/ui/reader/TocPanel.ts` 从 ~470 行扩到 823 行.

### 12.1 键盘导航 (↑↓ Home End ←→ Enter Space Esc)

**设计动机**: 用户反馈"目录打开后只能鼠标点章节, 频繁操作很慢". v5 加键盘 navigation — 不用离开键盘就能滚整个 TOC.

**实现位置**: `src/ui/reader/TocPanel.ts:601-680` (`handleKeyDown`).

| 键 | 行为 |
|---|---|
| `↓` / `↑` | moveFocus(±1) — 上下移动焦点, 跨过折叠的 children |
| `Home` / `End` | 跳到第一个 / 最后一个可见 row |
| `→` | 父项 toggle(展开→折叠 / 折叠→展开); 叶子无动作 |
| `←` | 父项且展开 → 折叠; 否则跳到父 row |
| `Enter` / `Space` | 跳到 focused row (调 `onJump(item)`) |
| `Esc` | 让 ReaderView 统一处理 (关 panel) |

**capture-phase + contains 检查**避免跟 Obsidian 全局快捷键冲突:
- listener 挂在 `panel root` 上, `addEventListener("keydown", handler, true)` (capture)
- handler 第一行 `if (!this.root.contains(target)) return;` — 焦点在 panel 外直接 return, 让 ReaderView 容器层 handler 接管 (翻页/页码)
- ReaderView 容器层 handler (在 `ReaderView.bindKeyboardNavigation:760-780`) 又做了一次 `if (this.tocPanel?.isVisible() && this.tocPanel.contains(event.target)) return;` 兜底, 防止 Home/End/Space 在 panel 内触发翻页

**焦点视觉**:
- `data-toc-id` 标记每个 row, focused row 加 `.is-focused` class → CSS outline (`.ez-reader__toc-row.is-focused:2264`)
- 当前章节也 focused 时用 inset shadow (避免 outline 喧宾夺主): `.ez-reader__toc-row.is-focused.is-active:2268`
- 焦点初值跟 active row (`setActive` / `show` / `toggle` 三处都设); 关 panel 时清掉 (`hide` 调 `focusedId = null`)
- 焦点在 search input 时让浏览器自己处理 (Esc 清空 query 等), 不接管

### 12.2 scrollActiveIntoView — setActive 时自动滚到可视区

**问题**: 用户开 panel 时, active row 可能不在可视区 (scroll position 是阅读器的, 跟 panel 无关), 用户得手动滚 panel 才能看到当前章节.

**实现位置**: `src/ui/reader/TocPanel.ts:298-309` (方法) + 调用点在 `setActive:190`, `show:214`, `toggle:239`.

**机制**:
- `private scrolledIds: Set<string>` — 记录已自动滚过的 id
- `scrollActiveIntoView(id)` — 第一次见到这个 id 时 `scrollIntoView({block:"nearest"})`, 同 id 后续 setActive 直接 return
- `setToc` 时 `scrolledIds = new Set()` 重置 (换书)

**为什么 dedup**: `relocate` 事件在用户翻页 / scroll 时高频触发, ReaderView 每次都 `setActive(match.id)` (在 ReaderView:1085). 如果不 dedup, 每次都 scrollIntoView 会打断用户手动滚动 panel.

**show() 处的特殊处理**: 如果 panel 之前 hidden, setActive 时 `scrollIntoView` 是 no-op (隐藏元素没 scroll position). show() 里手动 force 一次 (`scrolledIds` 不考虑这种情况).

### 12.3 面包屑 (current chapter path)

**设计动机**: 用户看大书 (e.g. "PART I → Chapter 2 → 2.3 Linear Stress-Strain"), 想跳回上层时不需要从根滚. 面包屑直接显示祖先链.

**实现位置**: `src/ui/reader/TocPanel.ts:359-399` (`renderBreadcrumb`).

**DOM 结构**:
- 面包屑独立 row: `.ez-reader__toc-breadcrumb-row` (位于 header 下方, tree 上方)
- 容器为空时加 `.is-empty` class → `display: none` (高度 0, 不占空间): CSS `styles.css:2223`
- 每个祖先一个 `.ez-reader__toc-breadcrumb__item`, 中间用 `›` sep
- 最后一个 item 加 `.is-current` (粗体, 不可点); 其他加 `.is-link` (hover 背景, click 调 `onJump(item)`)

**祖先链算法**:
- `ancestorPathOf(tree, activeId)` — 递归 tree, 找到 active 节点的路径 (返回所有祖先 id)
- chain = [...ancestors, activeNode.item] — 当前章节算最后一节

### 12.4 章节计数 chip `(N 章)`

**位置**: `src/ui/reader/TocPanel.ts:319-326`, 紧跟 header `<h3>` 标题.

**CSS**: `.ez-reader__toc-count:2195` — 灰底小字 (11px, `var(--background-modifier-border)`), 圆角 chip. `flex: 0 0 auto` 防止被挤没.

**渲染条件**: `items.length > 0` 才显示 (空 TOC 不显示 "0 章").

### 12.5 搜索高亮 `<mark>`

**位置**: `src/ui/reader/TocPanel.ts:523-547` (`fillLabelWithHighlight`).

**机制**:
- 搜索 query lowercase (`toLocaleLowerCase`), label 同样 lowercase 做 `indexOf`
- 匹配子串 wrap 进 `<mark class="ez-reader__toc-highlight">`, 其他部分 textNode 保留 case
- case-insensitive 匹配, 但 visual 上保留 label 原 case (textContent, 不解析 HTML, 安全)

**CSS**: `.ez-reader__toc-highlight:2255` — `var(--text-highlight-bg)` 黄色背景, `border-radius: 2px`, 不影响 layout.

**例子**: label = "Chapter 2: Wave Propagation", query = "wave" → `<mark>Wave</mark> Propagation`.

### 12.6 进度点 (visited / current / unvisited)

**设计动机**: 让用户一眼看出"哪些章节看过 / 现在在哪 / 哪些没碰过". 大书目录很长, 颜色提示比纯文本可读性强得多.

**位置**:
- DOM: `src/ui/reader/TocPanel.ts:505-506` (每个 row 末尾加 `.ez-reader__toc-progress-dot` span)
- CSS: `.ez-reader__toc-progress-dot:2275-2298` (3 个状态 class: `.is-current` 蓝 / `.is-visited` 绿 / `.is-unvisited` 灰)
- class 切换: `refreshVisitedStyles:582-597` — 根据 `this.visitedIds` + `this.activeId` 给每个 dot 加 class

**数据来源**:
- `setVisited(ids: Iterable<string>)` API — ReaderView 在 `relocate` 时把 `this.tocFractions.keys()` 传过来 (ReaderView:1109)
- `tocFractions: Map<id, number>` — ReaderView 被动记录 (chapter label 匹配 tocItems 找到 id, 写 `(id, fraction)`), **只在第一次记录** (`Map.has` 检查)

**v5 阶段没有持久化**: visited ids 仅在 session 内有效 (关 viewer / 重开就丢). v6 才加持久化 (§13.4).

### 12.7 `contains()` API (给 ReaderView)

**位置**: `src/ui/reader/TocPanel.ts:258-261`.

**用途**: ReaderView.bindKeyboardNavigation 在 capture 阶段做 `if (this.tocPanel?.isVisible() && this.tocPanel.contains(event.target)) return;` (ReaderView:769). 用 `this.root.contains(node)` 判断事件是否在 panel 内, 决定是否跳过自己处理.

**实现**:
```ts
contains(node: EventTarget | Node | null): boolean {
  if (!node || !(node instanceof Node)) return false;
  return this.root.contains(node);
}
```

**注意**: 入参是 `EventTarget`, 但 `Node.contains` 要 `Node`. 加 instanceof 兜底. 也不接受 React synthetic event 之类的 (本项目不用 React, 不用管).

### 12.8 测试基础设施 (v5 增量)

**新增**: `tests/core/TocPanel.test.ts` 扩到 1008 行 (从原来 ~84 行), 共 ~80+ 个测试 (从 296 → 296+v5 增量, 最终 v5 跑完 296 通过).

**覆盖**:
- 键盘: ↑↓HomeEnd←→EnterSpaceEsc 每个键单独 case, capture-phase 验证, ReaderView 容器层互不冲突
- scrollActiveIntoView: dedup (同 id 不重复滚), setToc 时清空
- 面包屑: ancestor 链正确, is-empty 时 hidden, click 调 onJump
- chip: items.length > 0 才显示
- 搜索高亮: `<mark>` 包裹, case-insensitive, 不破坏 label
- 进度点: visited/current/unvisited 三态 class 切换, setVisited 后正确刷新
- contains(): true/false 各种入参

---

## 13. TocPanel v6 详解 (commit `a67aa9c`)

> v5 解决了"能用键盘"+"看见进度", v6 解决"布局在长目录里稳不住"+"进度跨 session 还在". 4 个 fix 一口气做了, 文件改 751 行 (+大部分是 §13.1 重排).

### 13.1 Header 重排成两行 (面包屑挪到独立行)

**问题**: v5 header 把"标题 + N章 chip + × + search input + 面包屑"全挤一行. items ≥ 8 时 flex-wrap 把 search 挤没, 或面包屑被裁掉.

**方案**:
- header 第一行: `.ez-reader__toc-header` — 标题 + count chip + × + search input (8+ items 时)
- header 第二行: `.ez-reader__toc-breadcrumb-row` — 独立 div, 跟 §12.3 同一节点
- 面包屑 row 之前在 `renderHeader` 里**创建**, 现在挪出来 — `renderBreadcrumb` 只填内容 (`renderHeader:356` 一行 `this.root.createDiv({ cls: "ez-reader__toc-breadcrumb-row" })`)

**CSS 不变**: 面包屑 row 已经有 `border-bottom: 1px solid` (styles.css:2216), 跟 header 自然分隔. `is-empty` 时 `display: none` 高度 0.

**实现位置**: `src/ui/reader/TocPanel.ts:311-357` (`renderHeader`).

### 13.2 Panel 加宽 + 缩进减少

**问题**:
- 之前 `flex-basis: 320px` — 60% 用户长章节 label 被截断 ("Chapter 2: Wave Propag..." 看不全)
- 每层缩进 18px (12 + 6) — depth 4+ 的 leaf 太靠右, label 实际空间 < 100px

**方案**:
- `flex-basis: 320px → 380px` (styles.css:2007) — 多 60px 给 label
- 每层缩进 `18px → 14px` (8 margin + 6 padding, styles.css:2183-2186)
- label padding `6px → 4px`, dot margin `right 8 → 4`, `left 4 → 2` (styles.css:2167, 2280-2281) — 进一步挤出空间

**结果**: 380px panel, 14px 缩进/层, depth 5 leaf label 仍有 ~150px, 够看 "3.2.1 Linear Stress-Strain Relations".

**CSS 位置**: `styles.css:2006-2015` (panel 容器), `:2183-2190` (children 容器).

### 13.3 缩进竖线修复 (depth=0 dashed 改成 solid)

**问题**: 用户反馈 depth=1 父项竖线缺失, 看不出层级关系.

**调查**:
- 之前 `.ez-reader__toc-children` 在 depth=0 时被一个特殊 CSS rule 覆写成 `border-left: 1px dashed` (v4 之前的设计, 试图把 root 那一层跟子层视觉分开)
- 结果: 在某些 Obsidian 主题下 (e.g. 默认 dark), dashed 颜色跟 solid 几乎看不出来, 看着像缺失

**修复** (styles.css:2183-2186):
```css
.ez-reader__toc-children {
  margin-left: 8px;
  border-left: 1px solid var(--background-modifier-border);
  padding-left: 6px;
}
```
移除 depth=0 dashed 特殊覆写, 所有 children 容器统一 solid 竖线. 同时 CSS 注释解释了"用户反馈 ... 现在统一 solid".

**测试加固**: `buildTocTree` 加测试 — 深度跳级 (0→2→1→3, 即 EPUB toc 偶尔有的不规则嵌套) 仍正确归类; 父节点 children 容器 + toggle 视觉一致.

### 13.4 visited 持久化 (data.json 存)

**设计动机**: v5 进度点只在 session 内有效. 用户关 viewer → 重开 → 全灰. 不符合"进度可视化"的初衷.

**架构** — 跟 §11.4 inline note patch 一样的 4 层设计:

| 层 | 新增 | 文件:行 |
|---|---|---|
| **Schema** | `AnnotationSnapshot.visitedTocIdsByBookId?: Record<BookId, string[]>` | `src/core/ports/AnnotationStore.ts:49-55` |
| **Port** | `AnnotationStore.loadVisitedTocIds / saveVisitedTocIds` | `AnnotationStore.ts:109-121` |
| **Service** | `ReadingService.getVisitedTocIds / saveVisitedTocIds` 包装 | `src/core/services/ReadingService.ts:148-164` |
| **Adapter** | `ObsidianAnnotationStore.loadVisitedTocIds / saveVisitedTocIds` + `sanitizeVisitedTocIdsMap` | `src/adapters/obsidian/ObsidianAnnotationStore.ts:185-205` (sanitize), `:477-498` (实现) |
| **ReaderView** | openSession 后立即 load; tocFractions 新增时 debounce 300ms 写盘; onClose flush | `src/ui/reader/ReaderView.ts:1519-1550` |

**Adapter 细节** (`ObsidianAnnotationStore.ts`):
- `loadVisitedTocIds(bookId)` — `await this.load(); return snapshot.visitedTocIdsByBookId?.[bookId] ?? [];` — 旧 data.json 没字段时 fallback 空数组
- `saveVisitedTocIds(bookId, ids)` — 在 `mutate` 内 read-modify-write (跟 `setPinnedAt` 同样的模式), 避免两个并发 caller 互相覆盖. caller 自己保证去重 (ReaderView 用 `Set` 维护 `tocFractions.keys()`)
- `sanitizeVisitedTocIdsMap(input)` — `load()` 时跑一遍, 过滤掉非 string / 空串 / 重复 / 非 array 的 value. 损坏 data.json 不阻塞 load, 丢坏 entry 留好的.

**ReaderView 细节**:
- `openSession` 在 `setToc` **之前** (`ReaderView:1195-1210`) — 从 store 拉历史 visited ids, 写进 `tocFractions` (用 0 占位 fraction, 因为历史没有真实位置). 然后 `setToc` + `setVisited` — 进度点从打开就有绿色, 不需要等下次 relocate.
- 触发: `relocate` handler 在 `tocFractions.has(activeTocId)` 为 false 时 (即新章节第一次看到) 写 fraction + `setVisited` + `schedulePersistVisited()` (`ReaderView:1104-1112`)
- `schedulePersistVisited` — 300ms debounce (`ReaderView:1519-1527`), 跟 progress 一个时间常量但独立 timer. `flushVisited` 比对 `persistVisitedLastSnapshot`, 相同就不写盘.
- `onClose` (`ReaderView:518-522`) — clear timer, 立即 `flushVisited()`, 保证关 viewer 时未写盘的新 visited id 立即持久化 (避免"刚翻的章节没保存 → 关 → 重启丢失").

**Set 跨 setToc 不重置** (`TocPanel.ts:155-159`):
> P2 polish: 不要重置 visitedIds — ReaderView 在 openSession 完成后会先调 readingService.getVisitedTocIds() → setVisited, 接着才调 setToc. 如果 setToc 把 visitedIds 清掉, 刚才 setVisited 写的就丢了, 进度点全变灰. 让 visited 状态自然延续, 跨 setToc (如重新加载同一本书) 不丢.

**CSS / DOM 不变**: 进度点还是 `is-current` / `is-visited` / `is-unvisited` (§12.6). 颜色还是 蓝 / 绿 / 灰. 只是数据从 session 内变成 data.json 持久.

---

## 14. Cleanup — 删 15 个 unused index.ts barrel (commit `75b69c0`)

> 一次大扫除, 删掉 15 个 dead barrel 文件, build clean + 307/307 测试通过. 没有功能改动.

### 14.1 为什么删

**背景**: `commit e478132 refactor: 拆分为 core/adapters/ui 三层架构(脚手架)` 在每个子目录加了 `index.ts` 做 barrel, 形式如:

```ts
// src/adapters/foliate/index.ts (被删)
export * from "./FoliateBookReader";
```

**问题**:
- `Plugin.ts` 全部走具体路径 (`from "./adapters/obsidian/CoverCache"` 等), **没有任何地方 import 这些 barrel**
- `tests/` 也走具体路径
- 等于 15 个 dead file, 增加 `git grep` / IDE outline 噪音, 让"哪些是 public API"模糊

**调查**: `git grep -l 'from ".*index"' src/` 在删之前跑, 0 命中. 删掉不需要任何替代.

### 14.2 删了什么

15 个文件 (`commit 75b69c0`, 53 行总删除):

```
src/adapters/foliate/index.ts
src/adapters/index.ts
src/adapters/obsidian/index.ts
src/adapters/text/index.ts
src/adapters/translation/index.ts
src/core/entities/index.ts
src/core/index.ts
src/core/ports/index.ts
src/core/services/index.ts
src/core/types/index.ts
src/platform/index.ts
src/ui/index.ts
src/ui/reader/index.ts
src/ui/settings/index.ts
src/ui/shelf/index.ts
```

### 14.3 没引入替代

- 现有 import 全部走具体文件, 不依赖 barrel
- 未来如果要做"单入口 public API", 重新加 `src/index.ts` 即可, 但现在没需求就别留

### 14.4 验证

- `pnpm run build` clean, `main.js` + `styles.css` 正常生成
- `pnpm test` 307/307 通过
- 没破坏任何东西

**注意**: `src/platform/index.ts` 也在删之列 — `src/platform/` 目录本身只有 1 个文件 (空目录会被删, 或者保留), 但 commit 里保留目录本身, 只删 index.ts. 这层架构 (跟 `core/adapters/ui` 平行的 platform) 在代码里没真用, 删了反而更干净.

---

如果有任何不清楚的地方,**先读相关代码 + git log + 跑 `pnpm test`**,不要瞎猜。需要联系用户时直接说。
