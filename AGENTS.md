# AGENTS.md — EzReader 项目交接文档

> 这是给下一个接手的 AI agent / 开发者看的。请先读完 **TL;DR** 和 **当前未解决问题**,再深入阅读对应章节。

---

## TL;DR

**项目**: Obsidian 社区市场插件 `ez-reader`(从零重写,非 fork)。
**位置**: `/home/ljl/obsidian/local-book-reader/`
**远程仓库**: `git@github.com:alei37/ez-reader.git`,分支 `main`
**当前 HEAD**: `507e9a8`
**测试/部署路径**: `/home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/`
**架构**: 分层端口-适配器(Port/Adapter) + 严格 core/adapters/ui 分层。
**支持格式**: PDF(完全实现) + EPUB(部分实现,Android 有 bug)。

**关键风险点**:
1. **PDF 是否真能打开**(必须先验证,见 `507e9a8` commit 信息)
2. **EPUB 在 Android 上白屏**(老 bug,未修)
3. **TXT reader 还没写**(声明了 `format: "txt"` 但没有适配器)
4. **Foliate 没有应用 `ReaderAppearance`**(字号/行距/边距/主题被忽略)

---

## 1. 用户是谁,要做什么

### 用户信息
- **GitHub**: `alei37`(fork 自 `SunnyD0697/local-book-reader` v0.3.6)
- **使用设备**: Linux 桌面 + Android 平板(用 Syncthing 同步 vault)
- **Obsidian vault**: `/home/ljl/obsidian/obsidian_alei/`
- **语言**: 中文(代码注释混合中英文)
- **沟通风格**: 直接、不废话,经常只发一两句需求,需要你主动问细节

### 产品愿景
**个人书架 / 书库**(Goodreads 风格):
1. 用户手动从 vault 导入书籍 → 出现在书架
2. 书架可筛选 / 排序(状态、标签)
3. 点击封面 → 进入阅读器

**阅读器体验对标**: 微信读书。
- 字号 / 行距 / 边距 / 主题切换
- 翻页动画 / 触摸翻页
- 选中文字 → 摘录 / 翻译 / 复制
- PDF 渲染质量要对标 PDF++ 插件

### 同步注意事项
- **Syncthing 的 `.stignore` 排除 `.obsidian/`** —— 两台设备的插件数据(封面缓存、阅读进度、设置)是独立的
- 用户测试时通常先在 Linux 桌面改代码 → 部署到桌面 vault → 让用户在桌面验证,再手动推到 Android

---

## 2. 项目结构

```
/home/ljl/obsidian/local-book-reader/
├── AGENTS.md                ← 你正在读这个
├── README.md                ← 用户面向文档
├── PRIVACY.md
├── manifest.json            ← plugin id: "ez-reader", minAppVersion 1.12.7, mobile OK
├── package.json             ← pnpm 11.9.0, Node 22+, esbuild 0.25
├── esbuild.config.mjs       ← 主构建,inline worker text + blob URL
├── esbuild.tests.config.mjs ← 测试构建
├── tsconfig.json
├── pnpm-workspace.yaml
├── patches/                 ← foliate-js patch(移除 allow-scripts + 加 customElements guard)
├── styles.css               ← 全部样式
├── main.js                  ← 构建产物 (~2.9 MB)
└── src/
    ├── main.ts              ← 入口:先 import polyfills,再 import EzReaderPlugin
    ├── Plugin.ts            ← Obsidian 插件主类,装配所有依赖
    ├── platform/
    │   └── polyfills.ts     ← Android WebView polyfills
    ├── core/                ← 零 Obsidian 依赖
    │   ├── entities/        ← Book, Bookmark, Excerpt, ReadingState
    │   ├── ports/           ← BookSource, BookReader, AnnotationStore, TranslationProvider
    │   ├── services/        ← LibraryService, ReadingService, TranslationService
    │   └── types/           ← ReaderSettings (ReaderAppearance)
    ├── adapters/            ← Obsidian + foliate + pdfjs 实现
    │   ├── obsidian/        ← ObsidianBookSource, ObsidianAnnotationStore, CoverCache
    │   ├── foliate/         ← FoliateBookReader (EPUB)
    │   └── pdfjs/           ← PdfjsBookReader (PDF)
    └── ui/                  ← 渲染层
        ├── shelf/           ← 书架视图
        ├── reader/          ← 阅读器视图、工具栏、模态框
        └── settings/        ← 设置页
```

---

## 3. 架构关键决策

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
- `vault.getAbstractFileByPath(".obsidian/...")` 在 Linux 会拒绝,**跳过它**
- `adapter.getResourcePath(filePath)` 返回 `app://<hash>/<path>?<token>`,token 是 session-scoped,**必须每次启动重新生成**
- `isDesktopOnly: false` —— 必须考虑移动端 WebView 兼容性

### 3.3 文件 IO 模式
- 通过依赖注入 `BookBytesLoader`,**不要在 reader 里用 `fetch()`**(`obsidian://` 协议 fetch 不可用)
- 在 `Plugin.ts` 里实现 `makeBookBytesLoader`:
  ```ts
  const bookBytesLoader: BookBytesLoader = async (path) => {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return await this.app.vault.readBinary(file);
  };
  ```

### 3.4 阅读器适配器接口
`BookReader` 接口(`src/core/ports/BookReader.ts`)有这些方法:
- `open(book, host, appearance, loader) → ReaderSession`
- `extractCover(book, loader) → ExtractedCover | null`

`ReaderSession` 接口关键方法:
- `goTo(target)` / `currentFraction()` / `exportLocator()`
- `on(event, handler)` — 主要是 `"relocate"` 和 `"selection-change"`
- `close()` / `applyAppearance(appearance)`

**可选 zoom 方法**(仅 PdfjsSession 实现):
- `setScale?(scale: number)` / `setFitWidth?()`
- `currentScale?(): number` / `isFitWidth?(): boolean`

UI 层用 `session?.setScale !== undefined` 判断是否显示缩放控件。

### 3.5 资源持久化
- 封面缓存存到 `<Vault>/.obsidian/plugins/ez-reader/covers/`
- 路径映射存 `<Vault>/.obsidian/plugins/ez-reader/cover-paths.json`
- `CoverCache.writeCover` **原子写**(临时文件 + rename)
- `CoverCache.hydrateCovers` 在 `onLayoutReady` 之后串行调用,**跳过 `.obsidian/` 路径**

---

## 4. 当前未解决的问题(按优先级)

### 🔴 P0:验证 PDF 是否真能打开(`507e9a8` 之后)
**症状**: 用户说 "现在压根就打不开 pdf了"。

**最新 commit (`507e9a8`) 已经做的修复**:
1. `ReaderView.openSession` 加 try/catch,失败时 `renderOpenError(error)` 在 stage 区域显示红色错误面板(标题 + 消息 + 折叠 stack)
2. `PdfjsSession.gotoPage` 移除 `setTransform(dpr, 0, 0, dpr, 0, 0)`(pdfjs 内部会自己设,外层重设反而算错)
3. `host.clientWidth` fallback 从 `Math.max(clientWidth - 32, 200)` 改成 `measured > 100 ? measured - 32 : 600`
4. 工具栏加 `min-height: 40px; overflow-x: auto` 防布局塌陷
5. 移除 `image-rendering: -webkit-optimize-contrast` —— 那个 CSS 会强制 nearest-neighbor,**反而糊**

**用户测试步骤**(必须严格走完):
```
1. 完全退出 Obsidian(Linux 桌面)
2. 重启 Obsidian
3. 打开任意 PDF
4. 如果还是不行 → 把屏幕上的红色错误面板截图发给你
5. 截图要包含"技术细节"展开后的 stack trace
```

**最可能的根因**(已经排查但没确认):
- pdfjs 在 Electron HiDPI 下的兼容性问题
- 某个特定 PDF 文件触发的问题
- `host.clientWidth` 在第一帧 layout 没好的时候仍可能为 0

### 🟡 P1:EPUB 在 Android 上白屏
**症状**: 打开 EPUB 时显示空白。

**未修,未深查。可能原因**:
- foliate-js polyfill 不全
- Android WebView 对 Shadow DOM / customElements 支持差异
- 已被 `polyfills.ts` 加了 `Object.groupBy` / `Promise.withResolvers` / `ReadableStream[Symbol.asyncIterator]`,但可能还不够

### 🟡 P1:TXT reader 缺失
**症状**: `LibraryService` 接受 `format: "txt"`,但 `BookReader` 没有 TXT 适配器。

**临时方案**: 找到 TXT 适配器代码前,**在 `BookReader` 选择处把 txt 路由到 foliate 或跳过**。或者最简单:在 `LibraryService.scan` 里直接把 txt 排除掉。

### 🟡 P2:Foliate 不响应 ReaderAppearance
**症状**: 字号 / 行距 / 边距 / 主题切换在 EPUB 里**完全无效**。

**当前状态**: `FoliateBookReader.applyAppearance` 只设置了 `data-ez-reader-flow` 属性,其他什么都没做。

**怎么修**:
- foliate-js 1.0.1 用 iframe 渲染,需要往 iframe 里注入 CSS
- 通过 `book.getContents()` 拿到 iframe,然后 `iframe.contentDocument.head` 注入 `<style>`
- 或者用 `data-ez-reader-*` 属性 + CSS 变量(`.ez-reader__theme-sepia` 等已经写好了)

### 🟡 P2:首次使用引导
**症状**: 插件第一次启用,用户看到一个空书架,可能困惑。

**未实现**: 需要做 onboarding modal,提示"点击 + 加入你的第一本书"。

### 🟢 P3:翻译功能 Phase 1.3
**症状**: `GoogleTranslationProvider.translate` 仍 throw `"not implemented yet"`。

### 🟢 P3:滚轮 + Ctrl 缩放 PDF
**症状**: 鼠标在 PDF 上滚 + Ctrl 不能缩放。需要 addEventListener wheel + ctrlKey。

### 🟢 P3:翻页动画 slide effect
**症状**: 微信读书风格,翻页有滑动过渡。foliate 自带但 PDF 没有。

---

## 5. 已知的坑和解决方式

### 5.1 CSS 类名前缀
所有自定义 class 用 `ez-reader__` 前缀。例:`ez-reader__reader`, `ez-reader__reader-toolbar`, `ez-reader__pdf-stage`。

### 5.2 Toolbar 布局
**结构**: `[×] [◀ ▶ ▬▬▬▬▬ 42%] [+书签 Aa 摘录 书签] [− 适宽 +]`

**关键 CSS**:
- 整栏 `flex-wrap: nowrap`,中间 `__nav-group` 必须有 `min-width: 0`,否则会被按钮挤爆
- 进度条 `flex: 1 1 140px; min-width: 100px; max-width: 320px`,不能放太长
- `__meta` div 是 `display: none` + `position: absolute`,只在桌面端 hover 时显示章节标题

**绝对不要做**:
- 不要把进度条做成 300px 以上固定宽度
- 不要让 toolbar 高度塌缩到 30px(那是浏览器 button 默认行高),用 `min-height: 40px` 锁住

### 5.3 HiDPI Canvas 渲染
**正确做法**(在 `PdfjsSession.gotoPage`):
```ts
const dpr = Math.max(1, Math.floor(globalThis.devicePixelRatio ?? 1));
const displayWidth = viewport.width;
const displayHeight = viewport.height;
const pixelWidth = Math.max(1, Math.round(displayWidth * dpr));
const pixelHeight = Math.max(1, Math.round(displayHeight * dpr));
canvas.width = pixelWidth;
canvas.height = pixelHeight;
canvas.style.width = `${displayWidth}px`;
canvas.style.height = `${displayHeight}px`;
// 不要 setTransform, pdfjs 自己会算
await page.render({ canvasContext: ctx, canvas, viewport }).promise;
```

**绝对不要做**:
- 不要 `image-rendering: -webkit-optimize-contrast`(强制 nearest-neighbor,糊)
- 不要在 render 前 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`(pdfjs 内部会重置)

### 5.4 Text Layer 坐标
用 `pdfjsLib.Util.transform(viewport.transform, item.transform)` 把 PDF 坐标系转到 viewport 坐标系。

### 5.5 foliate-js patch
在 `patches/foliate-js@1.0.1.patch` 里:
1. 移除 `package.json` 里的 `allow-scripts`(esbuild 不识别,会报错)
2. 给 `node_modules/foliate-js/create-view.js` 加 `if (!customElements.get(...))` 守卫(避免重复注册 customElements)

打 patch 的命令:
```bash
pnpm patch foliate-js@1.0.1
# 编辑文件
pnpm patch-commit <path>
```

### 5.6 pdfjs Worker 配置
不要用 `new URL(..., import.meta.url)` 路径,Obsidian 打包后路径会变。
**正确做法**:
- esbuild 把 `pdfjs-dist/legacy/build/pdf.worker.min.mjs` inline 为字符串(在 `esbuild.config.mjs` 配置)
- 在 `PdfjsBookReader.open` 里把字符串包成 Blob URL 赋给 `GlobalWorkerOptions.workerSrc`
- 用 `workerConfigured` 单例避免重复创建

---

## 6. 构建 / 测试 / 部署

### 6.1 构建
```bash
cd /home/ljl/obsidian/local-book-reader
pnpm install              # 第一次或依赖变了
pnpm run build            # 产出 main.js (~2.9 MB)
```

### 6.2 测试
```bash
pnpm test                 # 18 个单元测试,全部通过
```

测试在 `tests/core/` 下,只测 `core/` 里的服务,**不启动 Obsidian**。

**测试时常见 mock 需求**:
- `loadCoverPaths` / `saveCoverPaths` 在 stub 里实现为内存 Map
- `BookReader` stub 提供 `open` 返回 fake session

### 6.3 部署到桌面 vault
```bash
cd /home/ljl/obsidian/local-book-reader
pnpm run build
cp main.js /home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/main.js
cp styles.css /home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/styles.css
cp manifest.json /home/ljl/obsidian/obsidian_alei/.obsidian/plugins/ez-reader/manifest.json
```

### 6.4 部署到 Android
- 用户手动用 Syncthing 同步整个 vault
- 因为 `.obsidian/` 被排除,需要用户手动 `adb push` 或者用其他方式
- 或者告诉用户 `git pull` 后手动复制

### 6.5 热重载
Obsidian 桌面版支持插件热重载(在设置里打开),改了代码后:
1. `pnpm run build`
2. Obsidian 里 `Ctrl/Cmd + P` → "Reload app without saving"
3. 不用完全退出

但用户经常要求**完全退出重启**(尤其测试 PDF 这种)。

---

## 7. 用户工作流(用来理解任务)

用户会这样跟你说话:
- "现在压根就打不开 pdf了" → 出错了,看 `console.log` / 错误截图
- "我觉得现在这个顶栏需要重做一下" → UI 改版需求
- "进度条没必要弄这么长" → 微调样式
- "PDF 渲染应该跟 PDF++ 一样清晰" → 质量需求
- "对标微信读书" → 体验对标

**怎么接任务**:
1. 先看用户的话,识别属于哪一类(改 bug / 加功能 / 调样式)
2. 改 bug:找对应的 commit history,理解上下文,**不要乱动其他模块**
3. 加功能:确认属于哪一层,先画 port 接口,再写适配器,最后做 UI
4. 调样式:**只改 `styles.css`**,不要碰 TS
5. 改完一定要 build + 部署到桌面 vault

---

## 8. 调试技巧

### 8.1 打开 Obsidian Console
- Linux: View → Toggle Developer Tools → Console
- 命令行: `obsidian --enable-logging`(默认就有)

### 8.2 关键日志
- `[ez-reader] failed to open book` — engine.open 失败(看 message)
- `[ez-reader] PDF cover extracted` — 封面提取成功
- `[ez-reader] PDF cover extraction failed` — 封面提取失败

### 8.3 测试 PDF 的位置
`/home/ljl/obsidian/obsidian_alei/02-Projects/每日文献/` 下的 PDF 是用户日常测试用例。
`/home/ljl/obsidian/obsidian_alei/04-resources/books/` 下有 EPUB。

### 8.4 Cannot reproduce in Node
PDF 渲染 / foliate iframe / canvas / Shadow DOM 在 JSDOM 里都跑不起来。
**只能用 Obsidian runtime 验证**。改完必须让用户在 Obsidian 里测试。

---

## 9. Git 工作流

### 9.1 Commit 风格
历史 commit message 都是中文前缀 + 英文说明,例:
```
fix(reader): 错误兜底 + 工具栏防溢出 + PDF 渲染去 setTransform
feat(reader): 顶栏重做 + PDF HiDPI 高清渲染 + 字号主题设置
style(shelf): 卡片比例从 2/3 改 3/4,减少瘦长感
```

**格式**: `<type>(<scope>): <中文简短描述>`
**type**: `fix` / `feat` / `style` / `refactor` / `test` / `docs` / `chore`

### 9.2 不直接 push
本地改完 build + 部署 → 让用户测试 → 用户确认 OK 后再 `git add . && git commit && git push`。

### 9.3 不要 force push
远程 main 分支保护,不要 reset。

---

## 10. 关键文件指针

| 文件 | 作用 | 何时改 |
|------|------|--------|
| `src/Plugin.ts` | Obsidian 主类,装配所有依赖 | 加新服务、改设置项 |
| `src/adapters/pdfjs/PdfjsBookReader.ts` | PDF 渲染 | 改 PDF 行为、加缩放、修渲染质量 |
| `src/adapters/foliate/FoliateBookReader.ts` | EPUB 渲染 | 改 EPUB 行为、修 Android 白屏 |
| `src/adapters/obsidian/CoverCache.ts` | 封面缓存持久化 | 改封面逻辑 |
| `src/ui/reader/ReaderView.ts` | 阅读器主视图 | 加阅读器功能、改交互 |
| `src/ui/reader/ReaderToolbar.ts` | 工具栏 | 改工具栏布局、加按钮 |
| `src/ui/reader/AppearanceModal.ts` | 字号主题模态框 | 改外观设置 |
| `src/core/ports/BookReader.ts` | 阅读器接口 | 加新能力(zoom / annotation 等) |
| `src/core/services/LibraryService.ts` | 书架逻辑 | 改导入、筛选、排序 |
| `src/core/services/ReadingService.ts` | 阅读进度 + 书签 + 摘录 | 改进度/书签/摘录逻辑 |
| `styles.css` | 全部样式 | 任何视觉调整 |
| `manifest.json` | 插件元数据 | 改版本、改 minAppVersion |
| `esbuild.config.mjs` | 构建配置 | 加新 worker、加新 loader |

---

## 11. 一句话总结

**这是一个从零重写的 Obsidian 阅读器插件**,核心是用分层架构支持 PDF + EPUB,正在打磨 PDF 渲染质量和阅读体验对标微信读书。
**当前最紧急的事**: 让用户在 Obsidian 里测试 `507e9a8`,确认 PDF 是否能打开,如果不能,把错误截图发回来。

---

如果有任何不清楚的地方,先读相关代码 + git log,不要瞎猜。需要联系用户时直接说,我会用 ask_user_question 工具问细节。
