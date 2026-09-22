# EzReader Changelog

所有 EzReader 版本的显著改动。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/), 版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [0.2.1] - 2026-09-22

### 修复 (Fixed)

- **Shelf 在加书后无法滚动** — `.ez-reader__shelf__body` 是 flex 子项, 缺 `min-height: 0` 导致内容撑高但 `overflow-y: auto` 永远不触发. 修后书架有 5+ 本书即出现原生滚动条.
- **Shelf 卡片太小看不清** — 上一版为了一屏装下把 density 砍到 140/180px, 用户反馈太挤. default 调回 **200px** cover-min, 配合 `min-height: 320px` 强制 uniform row height, 标题 `-webkit-line-clamp: 2`. 现在 1200px viewport 一屏 ~4 行, 多出的书向下滚.

## [0.2.0] - 2026-09-19

### 新增 (Added)

- **TocPanel 全面升级 (v5 + v6)** — 左侧 380px 边栏, 树状结构 (▾/▸ 折叠 + 缩进 + 竖线), 键盘导航 (`↑↓ Home End ←→ Enter Space Esc`), 面包屑 (祖先链可点跳转), 进度点 (已读绿 / 当前蓝 / 未读灰), 自动滚到当前章节, 搜索高亮 (`<mark>`), header 两行重排避免长目录挤掉搜索框
- **Quick actions (无 modal 打断)** — 阅读时按 `H` 一键高亮保存摘录 + 黄色高亮, 按 `B` 一键加书签 (label 自动 = `Chapter · %`), `Shift+H` 仍保留原 modal 流程
- **Inline note 编辑** — 笔记侧栏直接点 note 文字进 contenteditable, `blur` / `Cmd+Enter` / 再次点 ▸ 收起 → 自动保存, `Esc` 取消还原, 失败回滚原文字
- **Notes panel tabs** — 顶部 [全部 / 想法 / 摘录] 三 tab 切换, 带数量 chip
- **翻译抽屉复制按钮** — 长译文 `max-height: 50vh` 不撑屏, 复制成功后短暂变 "✓ 已复制" (1.5s 反馈)
- **章节标记条** — 阅读器进度条下方显示已访问章节位置 (灰点), 当前章节高亮, hover 1.4x + 主题色, click 跳转
- **TocPanel visited 持久化** — 已读 / 当前章节状态写入 `data.json` (字段 `visitedTocIdsByBookId`), 关 viewer / 重启 Obsidian 后进度点仍在
- **MOBI 内部链接跳转** — 章节间相对链接闭环, 跳内部 cross-ref 不再打开外部浏览器
- **Release workflow** — push `v*` tag 自动 build + 打 zip + 发 GitHub Release (`.github/workflows/release.yml`)
- **Translation provider 设置引导** — 选完后显示对应 API key 获取链接

### 改动 (Changed)

- **TocPanel 移到 body 最左** — 之前 flex row 顺序导致 stage 在 tocPanel 右边变成最右, 现在固定 [toc] [notes] [stage]
- **PDF 走 Obsidian 自带 PDFViewer** — 不再自渲染 PDF (删了 719 行 PdfjsBookReader), 选词 / 黄条 / 笔记侧栏通过自建 `PdfOverlay` 挂在 Obsidian 内置 PDFView 上
- **Toolbar 红 badge 改灰** — 之前用 `color-red` 像未读提醒, 现在 `background-modifier-border` 灰底灰字
- **Reader panel header 统一 × 按钮** — NotesPanel / BookmarksPanel / ExcerptsPanel 顶部全部加 × close 按钮 (之前用户反馈"找不到怎么关 panel"), `Esc` 现在统一关所有 panel
- **Bookmark / Excerpt 卡片重排** — jump + × 删除同一行, chapter / % / 时间上下文显示, 自由想法 (`text === ""`) 显示 `💭 自由想法` badge 而不是空 blockquote
- **EPUB chapter 实时同步** — 之前 foliate relocate 事件 `detail` 没 chapter 字段导致 toolbar 章节永远是 "", 现在实时读 `session.currentChapter()`
- **笔记 schema 增字段** — `visitedTocIdsByBookId?: Record<BookId, string[]>` 与 `updateExcerptNote` patch API (旧 data.json 没这字段 fallback `{}`)
- **测试覆盖** — 145 → 307 通过 (29 个 `.test.ts`, 涵盖 core + ui panel / styling)
- **`main.js` 大小** — 919 → 950 KB (+2.7%)
- **README 全面重写** — 加 快速开始 / 常见任务 (8 条 step-by-step) / FAQ / Shelf 截图, 与 AGENTS.md 同步

### 修复 (Fixed)

- **PDF 跨页选区** — 之前 P0 race; 现在跨页保存
- **进度持久化 race** — `persistProgress` 加 300ms debounce + 1% 距离阈值, 60Hz relocate 风暴期间只保留最后一次写盘
- **AddToLibrary Promise.allSettled** — 一条 reject 不再让其余已成功加入的书丢失
- **ReaderView `whenReady` `currentSessionToken`** — 切书时 `obsidian://` 协议 handler 重新等新 session (跨 `setEntry` race)
- **FoliateBookReader `applyAppearance` 抛错清理** — view + transformTarget listener 兜底清理, 不挂在已 detach view 上
- **FoliateBookReader `findInBook`** — closed 时提前退出, 不抛错
- **4 个 modal focus setTimeout 异常** — 关闭后 `setTimeout` 回调不抛 `DOMException`
- **MOBI 大文件资源释放** — `parser.destroy()` 兜底避免 blob URL 泄漏
- **EPUB 选词菜单不可靠** — foliate sandboxed iframe `selectionchange` 不可靠, 加 `mouseup` / `pointerup` / `touchend` 三重兜底 (桌面 + 移动端)
- **Toolbar 一键加书签 label** — clamp fraction 防止 -10% / 150% (NaN / Infinity 处理)
- **ShelfView static 字段** — `promptedForFirstImportWithoutStore` 静态字段 HMR 重置丢防弹, 改实例字段
- **`cycleShelfDensity` 失败回滚** — `patchSettings` 失败时回滚本地 + `Notice` 提示
- **CoverCache mkdir 竞态** — 3 worker 并发 `exists` + `mkdir` 的 TOCTOU race 修
- **PdfOverlay 兼容性** — PDF++ / 接管 PDF 的第三方插件改 PDFView DOM 时, fallback 走 `setEphemeralState` / `openLinkText("#page=N")` (不影响阅读)
- **首次加入时间 first-added wins** — 重复 add 同一本书不再回退 `addedAt` 到较大新值
- **Toolbar `addClass` variadic** — 不能传空格分隔字符串 (Obsidian API 是 variadic 不是单参)
- **`FoliateBookReader.open` 失败清空 view** — `view.open` 失败时清空 view 元素, 不留半挂状态

### 弃用 (Deprecated)

(无)

### 移除 (Removed)

- 15 个 unused `index.ts` barrel 文件 — 内部清理, 用户不可见 (`Plugin.ts` 走具体路径, 不依赖 barrel)

### 安全 (Security)

(无)

## [0.1.0] - 2026-09-13

初版发布。基础功能: EPUB / PDF / TXT / MOBI / AZW3 阅读, 选词摘录 + 想法 + 翻译 + 复制, 书架加入 / 筛选 / 排序, 笔记导出到 vault md。
