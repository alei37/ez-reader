# EzReader

EzReader 是一款 Obsidian 社区市场插件,把 Vault 本身变成个人图书馆 — EPUB / PDF / TXT / MOBI / AZW3 电子书躺在 Vault 的任意位置,你在 Obsidian 里打开阅读、做笔记、记录进度,产出仍是普通 Markdown,跟 vault 里的其它笔记无缝打通。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Shelf  (个人书架)                                                     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐  ┌─ 状态 ─┐  ┌─ 排序 ─┐  [+ 全部加入]     │
│  │封面│ │封面│ │封面│ │封面│  │ □ 在读  │  │ 标题升序 │                 │
│  └────┘ └────┘ └────┘ └────┘  │ □ 已读完│  │ 加入降序 │                 │
│  Alice  《小王子》  ……           └────────┘  └────────┘                 │
└──────────────────────────────────────────────────────────────────────┘
                          │  点击封面
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Reader                                                              │
│  [×]  [在读]  [★]   [◀] ▬▬▬▬▬ 42% [▶]   [+书签  Aa  摘录  笔记  目录] │
│                                                                       │
│   "所有的大人都曾经是小孩——只是很少有人记得了。"                     │
│   ──────────────────────────────                                     │
│   第 1 章 · 27%                                                      │
│                                                                       │
│  [选中这段文字]                                                       │
│   ┌─────────────────────┐                                            │
│   │ 想法 │ 摘录 │ 翻译 │ 复制 │                                       │
│   └─────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────┘
                          │  选 想法 / 摘录
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ zz_阅读与研究/阅读笔记/小王子-abcd1234.md                            │
│ ---                                                                  │
│ title: "小王子"                                                       │
│ ez-reader: /books/le-petit-prince.epub                                │
│ ---                                                                  │
│                                                                      │
│ > [!quote] 摘录                                                       │
│ > **小王子** · 第 1 章 · 进度 27% · EPUB                              │
│ > Created: 2026-01-15 21:34                                          │
│ > 返回原文: [打开阅读器](obsidian://ez-reader?book=…&annotation=…)     │
│ >                                                                    │
│ > 所有的大人都曾经是小孩——只是很少有人记得了。                       │
│                                                                    ^
│ ex-…                                                                 │
```

## 核心功能

### 个人书架 (Shelf)

- **手动加入** — 选书 → 一键加入,不自动扫描 (避免 vault 满时意外全扫)。从 EPUB / PDF 元数据读标题 / 作者 / 语言。
- **多视图** — 网格 (封面卡片) / 列表 (详细信息),`G` 切换。
- **状态跟踪** — 每本书标记 `未开始 / 在读 / 已读完 / 暂弃` + `★` 收藏。状态 pill 工具栏点击循环切换。
- **筛选 + 排序**:
  - 状态、语言、格式、进度段 (未读 / 早期 / 中期 / 后期 / 已读完)、最近打开 (今天 / 本周 / 本月 / 更早 / 从未)
  - 标题升降、作者首字母、加入时间、最近打开、阅读进度
  - 顶部搜索框,匹配标题 / 作者 / 标识符 / 路径
- **封面缓存** — 加入时异步抽取 (EPUB 用 foliate-js,PDF 沿用 Obsidian 自带),在插件目录下持久化。再次启动 vault 时不重新抽取。

### 阅读器

#### EPUB (ReaderView)

- **渲染**: foliate-js 1.0.1,带双页 / 滚动切换、跨章自动进度。
- **外观** (工具栏 `Aa` 按钮或 `Shift+H`):
  - 字号 60%–200%
  - 行距 1.0–2.4
  - 页边距 0–80 px
  - 主题:系统 / 浅色 / 暗色 / 米黄 (sepia)
  - 流动:翻页 / 滚动
- **沉浸模式** (`Shift+F`):pad / 桌面隐藏工具栏,顶部 80 px 滑动 / 鼠标移入 / 触摸调出。pad 启动时按设置自动进入。
- **进度记忆**:默认开,可关。打开书自动跳到上次位置 (cfi / page)。
- **章节标题**:nav-group 顶部永久小字显示当前章节,微信读书风格。
- **多设备同步**:状态、书签、摘录、笔记都走 vault 内的 `data.json` + markdown 笔记,通过 Syncthing / git 在多设备同步 (`.obsidian/` 之外的部分)。

#### PDF

- **渲染**:PDF 文件交给 Obsidian 自带 `pdf` view 处理 (标准 Markdown 链接 `[[path.pdf]]` 走这条路);可与 [obsidian-pdf-plus](https://github.com/RyotaUshio/obsidian-pdf-plus) 等增强插件并存。
- **EzReader 浮层 (PdfOverlay)**:透明挂在 PDFView 上,提供
  - 选词菜单:翻译 / 摘录 / 复制
  - 浮动 `📝` 按钮 → 笔记侧栏 (书签 / 摘录列表,可跳转原文位置)
  - 高亮回显:重新打开 PDF 时按页 + 文本匹配自动画黄色高亮 div (text-anchor 算法,多行 / 多 word 全画)
- **跨页选区**:本版本仍按页分别保存;跨页选区按可见页分别高亮。

#### TXT / MOBI / AZW3 (PagedTextSession)

三个纯文本 / 章节文本格式共享同一个 `PagedTextSession` (跟 EPUB 的 foliate 在不同 engine,但 UX 完全一致:同一套划词 / 摘录 / 高亮 / 翻页 / 主题):

- **TXT** — UTF-8 纯文本,按段落切页 (默认 1600 字符 / 页)。切页时不让段落从中间断开,除非单段超过整页才在句子边界 (中英文标点) 硬切。HTML 特殊字符全部 escape,防注入。
- **MOBI / AZW3** — 通过 `@lingo-reader/mobi-parser` 解包 Mobipocket 章节记录,每章一页。章节内嵌的图片 / CSS 自动注入;TOC / 章节进度 / 翻页动画跟 EPUB 一致。
- **进度持久化** — 用 `position: { kind: "text", fraction, start, end }` 记录 `paged-text:<pageIdx>` 定位器,关闭重开可恢复到原页。
- **不做什么**:
  - TXT 没封面 (返回 null,书架用占位封面)。
  - 不识别 GBK / GB18030 编码 — 用户需要把 GBK 文件重新存为 UTF-8 才能正常打开。

### 选词交互 (Selection Menu)

划词后 180ms 自动弹 4 按钮菜单,布局:`想法 | 摘录 | 翻译 | 复制`。

- **想法** — 写一段不依赖选词的感想。绑定到当前章节 / 进度,落到笔记的 callout。
- **摘录** — 高亮 + 笔记。可附加标签 (`#AI` `#方法论`) + 自己的评论。
- **翻译** — 走配置的翻译 provider (见下方),只把选中的片段发出去,不带上下文。
- **复制** — 写系统剪贴板,带字符数 Notice。

中文段落里浏览器按字符分词太碎,菜单触发时会自动把选区扩到最近的句号 / 逗号 / 换行 (cap 100 字符),让想法 / 摘录更有意义。

### 键盘快捷键

| 操作 | 默认键 | 备注 |
|------|--------|------|
| 上一页 | `←` / `PageUp` / `Shift+Space` | |
| 下一页 | `→` / `PageDown` / `Space` | |
| 跳到首 / 末 | `Home` / `End` | |
| 保存摘录 (选词后) | `Shift+H` | |
| 翻译选词 | `Shift+T` | |
| 切换笔记侧栏 | `S` | |
| 切换目录 | `T` | |
| 切换沉浸模式 | `Shift+F` | (小写 `f` 不再响应,避免与 foliate 内部查找冲突) |
| 复制选区 | `C` | |
| 显示快捷键帮助 | `?` | |
| 退出 / 关闭面板 | `Esc` | 不截获 — 让 Obsidian 默认行为也能跑 |

`prev` / `next` / `translate` / `highlight` / `toggleSidebar` / `toggleToc` 可在 Settings 里重映射。

### 笔记 (NoteWriter)

每次选词摘录 / 想法,落到 `<notesDirectory>/<标题>-<bookId 前缀>.md`:

```markdown
---
title: "小王子"
ez-reader: /books/le-petit-prince.epub
source: /books/le-petit-prince.epub
created: 2026-01-15
---

# 小王子

> 由 EzReader 自动生成。划词摘录与想法会出现在此笔记中,带 Obsidian 块 ID 可被双向链接。

> [!quote] 摘录
> **小王子** · 第 1 章 · 进度 27% · EPUB
> Created: 2026-01-15 21:34
> 返回原文: [打开阅读器](obsidian://ez-reader?book=…) · [[#^ex-uuid|回到此摘录]]
>
> 所有的大人都曾经是小孩——只是很少有人记得了。
^ex-uuid
```

- 每条摘录带 Obsidian 块 ID,任何其它笔记可以用 `[[book-note#^<excerptId>]]` 反向引用。
- "返回原文" 链接走 `obsidian://ez-reader?book=<path>&annotation=<id>` 协议,Plugin 注册的 handler 收到后会跳到对应书的对应位置并临时高亮该摘录。

## 翻译 (可选,需要网络)

唯一会发网络请求的功能,且只在用户明确点击 "翻译" 时触发。详细边界见 [PRIVACY.md](PRIVACY.md)。

- **默认关闭** — 没填 API key 时 `translate` 直接抛错。
- **只发选中的片段** — 不发文件、不发上下文、不发 user identifier。
- **Key 存在本地** `<Vault>/.obsidian/plugins/ez-reader/data.json`,只发给对应 provider 的鉴权端点。
- **多个 provider 可配置**:
  - **有道翻译** (有道智云)
  - **DeepL**
  - **Google Cloud Translation v3**
- **目标语言** 从 settings 读取,默认 `zh-CN`。

填 key 切换 provider / 改目标语言 → 下一次翻译立即生效 (settings 改动会立刻 bust translation cache)。

## 平台支持

- **桌面** (Windows / macOS / Linux):Obsidian 自带 Chromium,功能全开。
- **移动** (Android / iOS):Obsidian 自带 WebView。Android 上老 WebView 缺 `Object.groupBy` / `Promise.withResolvers`,Plugin 自带 polyfill bundle 兜底。
- **最低 Obsidian 版本**:1.12.7。

## 支持的文件格式

- **EPUB** (`.epub`) — 完整支持,自带 foliate-js (带 customElements patch)。
- **PDF** (`.pdf`) — 走 Obsidian 自带 viewer + EzReader `PdfOverlay` 浮层 (选词 / 笔记 / 高亮回显)。
- **TXT** (`.txt`) — 纯 UTF-8 文本。`TxtBookReader` 按段落切页 (默认 1600 字符/页,段落不打断),渲染到 `PagedTextSession`。
- **MOBI / AZW3** (`.mobi` / `.azw3`) — Mobipocket 与 Kindle Format 8。`MobiBookReader` 包了 `@lingo-reader/mobi-parser`,章节当页、原生支持 MOBI 章节内嵌的图片 / CSS。
- **AZW** (`.azw`) — 类型已声明,但还没有 reader。书架扫描会过滤,文件不显示。等以后有人补 azw reader,只改一行 `READER_CAPABLE_FORMATS` 就生效。

## 架构

分层 port / adapter,严格 core / adapters / ui 边界:

```
core/        (纯逻辑,零 Obsidian 依赖)
   ├─ entities/    Book, Bookmark, Excerpt, ReadingState
   ├─ ports/       BookSource, BookReader, AnnotationStore, TranslationProvider, NoteWriter
   ├─ services/    LibraryService, ReadingService, TranslationCoordinator
   └─ types/       ReaderSettings, ShelfFilter, Locale

adapters/     (Obsidian / foliate / mobi-parser 具体实现)
   ├─ obsidian/    ObsidianBookSource, ObsidianAnnotationStore, CoverCache, ObsidianNoteWriter
   ├─ foliate/     FoliateBookReader (EPUB)
   ├─ text/        TxtBookReader (TXT) + MobiBookReader (MOBI/AZW3) + PagedTextSession (共享 session)
   └─ translation/ YoudaoTranslationProvider, DeeplTranslationProvider, GoogleTranslationProvider, BaseTranslationProvider

ui/           (DOM 渲染,用户交互)
   ├─ shelf/       ShelfView, ShelfToolbar, ShelfFilters, AddToLibraryModal, OnboardingModal
   ├─ reader/      ReaderView, ReaderToolbar, AppearanceModal, ReaderSelectionMenu, BookmarksPanel, ExcerptsPanel, SidebarNotesPanel, TocPanel, TranslationDrawer, pdfOverlay
   └─ settings/    SettingsTab

platform/     (Obsidian runtime polyfills)
Plugin.ts     (装配所有依赖)
```

硬规则:

- `core/` 永远不 `import "obsidian"`。
- `core/ports/*` 是接口,实现必须在 `adapters/`。
- `ui/` 通过 port 跟 core 通信,不直接读文件。

测试只覆盖 `core/`(`tests/core/*.test.ts` → `tests/dist/core/*.mjs` → `node --test`),不启动 Obsidian runtime。

## 隐私 / 数据落盘

- 原书文件**只读**,从不拷贝 / 移动 / 重命名 / 删除。
- 状态、书签、摘录、收藏、进度、设置、首次加入时间、首次打开封面缓存索引,都存在 `<Vault>/.obsidian/plugins/ez-reader/data.json`。
- 封面图片缓存到 `<Vault>/.obsidian/plugins/ez-reader/covers/`,删除不影响阅读数据 (下次打开书时重新抽取)。
- Per-book markdown 笔记写到用户配置的 `notesDirectory`,带 Obsidian 块 ID 可双向链接。
- 翻译是唯一会出 vault 的网络动作,只在用户主动触发时发生。

## 安装

### 推荐:从 GitHub Release

到 [Releases](https://github.com/alei37/ez-reader/releases) 下载 zip,解压到:

```
<Vault>/.obsidian/plugins/ez-reader/
├── main.js
├── manifest.json
└── styles.css
```

启动 Obsidian → Settings → Community plugins → 启用 **EzReader**。

### 源码编译

需要 Node.js ≥ 22.13.0 + pnpm ≥ 11.9.0。

```bash
pnpm install --frozen-lockfile
pnpm run build     # 产出 main.js / styles.css / manifest.json
```

部署到本地 vault:

```bash
cp main.js styles.css manifest.json /path/to/<Vault>/.obsidian/plugins/ez-reader/
```

### 从 Local Book Reader 迁移

EzReader 是独立插件,**不**自动导入旧数据。手动迁移:

1. 旧插件 Settings → 导出核心数据备份,得到 JSON 文件。
2. 卸载旧插件 (保留备份 + `data/` 目录以防回滚)。
3. 安装 EzReader 到 `<Vault>/.obsidian/plugins/ez-reader/`。
4. 启用 EzReader → Settings → 从备份恢复核心数据,选 JSON。
5. 书架上点重新扫描,把书文件 re-bind 到新书记录。

## 开发工作流

```bash
pnpm test            # 单元测试 (145 个 case)
pnpm run build       # 类型检查 + esbuild 打包
pnpm run dev         # watch 模式 (主进程变化,需 Obsidian 端 reload)
pnpm run dev:web     # watch 模式 (client-plugin)
```

改完代码 → `pnpm run build` → `cp` 三个文件到 vault 目录 → Obsidian 里 `Ctrl/Cmd+P` → "Reload app without saving"。

不直接 commit / push — 本地改完 + 用户验证后再 `git add . && git commit && git push`。

## 已知边界

- 扫描版 PDF 没有 OCR (EzReader 不解析扫描图)。
- 不做自动分类 / 重命名 / 移动 / 合并 / 删除书文件。
- PDF 跨页选区不支持 — 每页独立保存,跨页选区按可见页分别高亮。
- **PDF "回到原文" 链接** 只跳到页 (`#page=N`),不支持跳到页内精确 subpath
  (4-tuple begin/end offset)。需要等 Obsidian PDFView 暴露内部 API 才能精确。
  当前行为:跳到页 + highlight 画在正确位置,可能要手动 scroll 一下看到。
- **PDF++ / 接管 PDF 的第三方插件** 可能改 Obsidian PDFView 的 DOM 结构,
  EzReader 的 PdfOverlay 挂不上 → 跳页走 fallback `setEphemeralState`
  (会有 `handleProtocol: PdfOverlay not found` console 警告)。不影响阅读。
- **MOBI 大文件 (>5 MB)** `createParser` 同步解压 2-5 秒,UI 短暂假死。
  已知问题,下次重写用 Web Worker 异步解压。
- **TXT 跨页摘录** 不支持 — 单页渲染架构下浏览器 selection 只在可见 DOM。
- **Android 端未测**。foliate iframe 在 Android WebView 行为可能有差异。
- AZW 暂未实现 reader — 类型已声明,书架扫描过滤,等以后补 reader 时只改一行 `READER_CAPABLE_FORMATS`。
- TXT 默认假设 UTF-8 编码;GBK / GB18030 文件需要用户先重新存为 UTF-8 才能正常打开。
- 翻译 provider 看到用户选中的内容,敏感文本请勿选中翻译。

## 作者与许可

- 作者:[alei37](https://github.com/alei37)
- 起源:fork 自 [Sunny D's Local Book Reader](https://github.com/SunnyD0697/local-book-reader) v0.3.6
- License:[MIT](LICENSE)
- 第三方组件保留各自许可,见 [LICENSES/](LICENSES)