# PDF++ (RyotaUshio/obsidian-pdf-plus) 源码研究 & 复用方案

> 研究目标:确认能否借用 PDF++ 的核心能力(annotation / 双链 / TOC / 缩放)到 ez-reader
> 报告时间:基于 PDF++ v0.40.31 (`main` 分支,2024-09 时点),我们的项目 `507e9a8`
> License: **MIT** — 可复用,需保留 copyright + license 副本

---

## 0. TL;DR(给用户的答案)

| 问题 | 结论 |
|---|---|
| 是否切换到 PDF++ 引擎? | **不要切换**。PDF++ 不是独立引擎,是 Obsidian 原生 PDF viewer 的 monkey-patch 扩展,绑死在 `pdf-container` 内部,无法作为我们的 BookReader 后端。 |
| 是否复用代码? | **强烈推荐复用部分核心算法**。具体:`computeMergedHighlightRects`(矩形 → DOM 高亮)、`getTextByRect`(矩形 → 文本)、`parsePDFSubpath`/`paramsToSubpath`(subpath 格式)、`getPageAndTextRangeFromSelection`(DOM Selection → 4-tuple)。MIT 协议下直接复制即可。 |
| PDF 高亮 + Obsidian 双链最简方案 | **3 步**就能跑起来。扩 BookReader port → 复用 PDF++ 的 4-tuple selection 算法 → UI 加"复制为 Obsidian 链接"按钮。**不需要 monkey-patch、不需要改 PDF 文件本身**。 |

---

## 1. PDF++ 是怎么构建的?(架构真相)

### 1.1 它**不是**一个独立 PDF 引擎

这一点和 Folio / PDF.js / pdf-lib 完全不同。PDF++ 是一个 **Obsidian 插件**,它的核心动作是:

1. 监听 Obsidian 内置 PDF viewer 创建
2. 用 `monkey-around` 库 monkey-patch Obsidian 的私有 API(`PDFViewerChild.prototype.applySubpath`、`PDFViewerChild.prototype.loadFile` 等)
3. 在 PDF viewer 之上叠加自己的 UI / 数据层

**关键代码** (`src/patchers/pdf-internals.ts`, ~60KB):
- 它修改了 Obsidian 内部 `PDFViewerChild` 类的方法
- 往 PDF viewer DOM 里插入自己的 `pdf-plus-backlink-highlight-layer` 层
- 修改 Obsidian 对 `#page=N&selection=...` 这种 subpath 的解析逻辑

### 1.2 它依赖的库

```json
// PDF++ 的 package.json
{
  "devDependencies": {
    "pdfjs-dist": "^5.4.54",           // 我们用 6.1.200,接近
    "@cantoo/pdf-lib": "^2.4.3",      // 用于修改 PDF 文件本身(可选)
    "monkey-around": "^3.0.0",         // 用于 monkey-patch Obsidian 私有 API
    "obsidian": "latest"
  }
}
```

**注意**:PDF++ 自己也用 `pdfjs-dist`,所以"PDF++ 用什么库"的答案 = **和我们一样用 pdfjs-dist**(我们版本还更新)。"它核心的渲染 / 文本提取 / 坐标变换全是 pdfjs-dist 干的"。它写的代码本质上是 **"用 monkey-patch 把 Obsidian 原生 PDF viewer 的私有 API 暴露出来,然后在自己的代码里用"**。

### 1.3 源码结构

```
src/
├── main.ts                          # 插件入口,~32KB
├── patchers/                        # 全部 monkey-patch 在这
│   └── pdf-internals.ts             # 59KB,核心 patch
├── lib/                             # 业务逻辑,plugin 暴露的 API
│   ├── copy-link.ts                 # 把 PDF 选区变成 Obsidian 链接 ★
│   ├── pdf-backlink-index.ts        # 解析 vault 里所有 [[file.pdf#...]] 反向链接 ★
│   ├── outlines.ts                  # PDF 大纲/书签读写
│   ├── highlights/                  # ★★★ 高亮核心
│   │   ├── geometry.ts              #   selection 4-tuple → 矩形数组
│   │   ├── extract.ts               #   矩形 → 文本(反向)
│   │   ├── viewer.ts                #   矩形 → DOM 高亮层
│   │   └── write-file/              #   (可选)用 pdf-lib 写回 PDF 文件
│   ├── commands.ts                  # 40KB,各种命令
│   ├── workspace-lib.ts             # workspace 集成
│   └── index.ts                     # PDFPlusLib 统一出口
├── utils/
│   └── index.ts                     # ★ parsePDFSubpath / paramsToSubpath 在这
├── post-process/                    # PDF 内部链接、outline 点击的处理
└── typings.d.ts                     # Obsidian 私有 API 的 type 声明
```

### 1.4 渲染流程(我们的场景下不可用)

```
Obsidian 打开 PDF
    ↓
Obsidian 创建内置 PDFView (用 pdfjs-dist 渲染)
    ↓
PDF++ 的 patcher 监听 layout-change → 找到 PDFView
    ↓
monkey-around.patch(PDFViewerChild.prototype, 'applySubpath', ...)  // 修改 subpath 解析
monkey-around.patch(PDFViewerChild.prototype, 'loadFile', ...)      // 修改文件加载
    ↓
在 PDF viewer DOM 之上插入 .pdf-plus-backlink-highlight-layer
    ↓
监听 vault 的 metadataCache change → 找到所有 [[file.pdf#selection=...]]
    ↓
在对应页面渲染高亮 DOM
```

**这个流程绑死在 Obsidian 私有 API 上**,不能脱离 Obsidian 跑。所以 PDF++ 没法当我们的后端。

---

## 2. PDF++ 的核心能力(对我们有用的部分)

### 2.1 Annotation / 高亮 — 两种模式

#### 模式 A:Backlink 高亮(**不写 PDF 文件**,完全靠 markdown 反向链接)
- 选中文本 → 复制成 `[[file.pdf#page=1&selection=4,0,5,20&color=yellow]]`
- 任何 markdown 文件里有这个链接,PDF viewer 打开该 PDF 时就自动在那一段画黄底
- **优点**:完全不动 PDF 文件,plugin 卸载后链接依然可读
- **缺点**:只在 Obsidian 内有效,导出后看不到高亮

#### 模式 B:写回 PDF 文件(**改 PDF 字节**,需要 `@cantoo/pdf-lib`)
- 选中文本 → 直接给 PDF 加 Highlight annotation
- **优点**:在所有 PDF 阅读器里都能看到高亮
- **缺点**:PDF 文件被改,plugin 卸载后高亮依然在(但你不知道哪些是 ebook 自己的)

**我们ez-reader用户应该走模式 A**。模式 A 完全不需要修改 PDF 文件,实现简单 10 倍。

### 2.2 "CFI" 格式 — 实际上是 4-tuple selection

PDF++ 没有用 EPUB CFI,而是用了**更简单的方案**:`page + 文本项索引 + 字符偏移`

```typescript
// src/utils/index.ts (utils/index.ts:230-243)
export function parsePDFSubpath(subpath: string): 
    | { type: 'page', page: number }
    | { type: 'selection', page: number, beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }
    | { type: 'annotation', page: number, annotation: string }
    | null
```

生成的 subpath 例子:
```
#page=1                                              // 只到页
#page=1&selection=4,0,5,20                            // 第 1 页,文本项 4 的字符 0 到文本项 5 的字符 20
#page=1&selection=4,0,5,20&color=yellow              // 加颜色
#page=1&annotation=123R                              // 已有的 PDF annotation,id 是 "123R" (PDF.js 格式)
#page=1&offset=100,200,1.5                           // XYZ 坐标跳转
#page=1&rect=0,0,595,842                             // 矩形裁剪嵌入
#page=1&search=keyword                               // 搜索
```

**核心数据结构**:`{ beginIndex, beginOffset, endIndex, endOffset }` 来自 PDF.js 的 `getTextContent().items[]` 数组。每个 item 是 PDF 里一个文本片段(一行、一个 word 或一个 char,取决于 PDF 生成方式)。`beginIndex` 是 item 在 items 数组的下标,`beginOffset` 是该 item 的 `str` 字段中的字符位置。

**好处**:
- 比 CFI 简单(不用理解 CFI 的 step / offset / assertion / range offset)
- 跨平台稳定(只要 PDF.js 解析结果一致)
- **不需要 PDF 坐标**,完全在 pdfjs 的 logical 空间里

### 2.3 TOC / 大纲

PDF++ 用 `@cantoo/pdf-lib` 读 / 写 PDF 的 `/Outlines` 字典:

```typescript
// src/lib/outlines.ts (outlines.ts)
export class PDFOutlines {
    root: PDFOutlineItem | null;  // 解析 PDF /Outlines 树
    getLeaves(): PDFOutlineItem[];
    iter(callbacks: { enter?, leave? });
    stringify(): string;  // 渲染成 markdown
}
```

但**读 outline 完全可以不用 pdf-lib**,直接用 pdfjs-dist 的 `pdfDocument.getOutline()`:

```typescript
const outline = await pdfDoc.getOutline();
// outline: Array<{ title: string, dest: any, items?: Array<...> }>
```

我们当前的 PdfjsBookReader **没用 `getOutline()`** — 这是个空缺,加上就能让 TOC 跑起来。

### 2.4 缩放

PDF++ 完全依赖 Obsidian 原生 viewer 的缩放按钮,自己没写。
我们的 PdfjsBookReader 已经有 `setScale` / `setFitWidth` / `currentScale` / `isFitWidth` — **这部分已经比 PDF++ 强**。

---

## 3. PDF++ 的可复用 API / 代码

### 3.1 ★★★ `computeMergedHighlightRects` — selection 4-tuple → 矩形数组

**文件**:`src/lib/highlights/geometry.ts`(geometry.ts:15-52)
**作用**:给定 `{ beginIndex, beginOffset, endIndex, endOffset }`,返回一组合并后的 PDF 坐标矩形 `[left, bottom, right, top]`(PDF 原生坐标系)。**这就是高亮的灵魂**。

```typescript
// 简化版(关键思路)
computeMergedHighlightRects(textLayer: { textDivs: HTMLElement[], textContentItems: TextContentItem[] }, beginIndex, beginOffset, endIndex, endOffset): MergedRect[] {
    const results: MergedRect[] = [];
    let mergedRect: Rect | null = null;
    let mergedIndices: number[] = [];

    if (endOffset === 0) {  // 选区刚好在一个文本项边界
        endIndex--;
        endOffset = textContentItems[endIndex].str.length;
    }

    for (let index = beginIndex; index <= endIndex; index++) {
        const item = textContentItems[index];
        const textDiv = textDivs[index];

        if (!item.str) continue;

        const rect = this.computeHighlightRectForItem(item, textDiv, index, beginIndex, beginOffset, endIndex, endOffset);
        if (!rect) continue;

        if (!mergedRect) {
            mergedRect = rect;
            mergedIndices = [index];
        } else {
            const mergeable = this.areRectanglesMergeable(mergedRect, rect);
            if (mergeable) {
                mergedRect = this.mergeRectangles(mergedRect, rect);
                mergedIndices.push(index);
            } else {
                results.push({ rect: mergedRect, indices: mergedIndices });
                mergedRect = rect;
                mergedIndices = [index];
            }
        }
    }

    if (mergedRect) results.push({ rect: mergedRect, indices: mergedIndices });
    return results;
}
```

辅助函数:
- `computeHighlightRectForItemFromChars` — 用 `item.chars` (PDF.js includeChars:true 才有)逐字符算 bbox
- `computeHighlightRectForItemFromTextLayer` — fallback,没 chars 时用 DOM Range.getBoundingClientRect 反推
- `areRectanglesMergeableHorizontally / Vertically` — 同一行 / 同一列的矩形可合并
- `mergeRectangles(...rects)` — 几个 rect 合成一个大 rect

**对我们的价值**:极大。我们现在 PdfjsBookReader 的 `selection-change` 只发了 `{ text, locator: "page=N" }` 一个字符串 — **没有 4-tuple**。加上这个,就能精确把链接跳回原文位置。

### 3.2 ★★★ `getTextByRect` — 矩形 → 文本

**文件**:`src/lib/highlights/extract.ts`(extract.ts:74-95)
**作用**:给定 PDF 坐标的 rect,从 text content items 里取出里面包含的文字。**反方向**,用于"已存的高亮重新定位"。

```typescript
getTextByRect(items: TextContentItem[], rect: Rect): PDFTextRange {
    const [left, bottom, right, top] = rect;
    let text = '';
    let from = { index: -1, offset: -1 };
    let to = { index: -1, offset: -1 };

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.chars && item.chars.length) {
            for (let offset = 0; offset < item.chars.length; offset++) {
                const char = item.chars[offset];
                const xMiddle = (char.r[0] + char.r[2]) / 2;
                const yMiddle = (char.r[1] + char.r[3]) / 2;
                if (left <= xMiddle && xMiddle <= right && bottom <= yMiddle && yMiddle <= top) {
                    text += char.u;
                    if (from.index === -1) from = { index, offset };
                    to = { index, offset: offset + 1 };
                }
            }
        }
    }
    return { text, from, to };
}
```

### 3.3 ★★★ subpath 解析 / 生成

**文件**:`src/utils/index.ts`(utils/index.ts:218-243 + 245-249)

```typescript
// 解析 #page=1&selection=4,0,5,20&color=yellow
export function parsePDFSubpath(subpath: string): 
    | { type: 'page', page: number }
    | { type: 'selection', page: number, beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }
    | { type: 'annotation', page: number, annotation: string }
    | null {
    const params = subpathToParams(subpath);  // URLSearchParams
    if (!params.has('page')) return null;
    const page = +params.get('page')!;
    if (params.has('selection')) {
        const [beginIndex, beginOffset, endIndex, endOffset] = 
            params.get('selection')!.split(',').map(s => parseInt(s.trim()));
        return { type: 'selection', page, beginIndex, beginOffset, endIndex, endOffset };
    }
    if (params.has('annotation')) {
        return { type: 'annotation', page, annotation: params.get('annotation')! };
    }
    return { type: 'page', page };
}

// 反向:对象 → subpath 字符串
export function paramsToSubpath(params: Record<string, any>): string {
    return '#' + Object.entries(params)
        .filter(([k, v]) => k && (v || v === 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
}
```

**对我们的价值**:**这就是 PDF++ 的"CFI"**。我们直接复制过来当 core/util 的一个 helper。

### 3.4 ★★★ Selection → 4-tuple (DOM 选区到 pdfjs 坐标)

**文件**:`src/lib/copy-link.ts`(copy-link.ts:21-58)

```typescript
getPageAndTextRangeFromSelection(selection?: Selection | null): { page, selection? } | null {
    const pageEl = this.lib.getPageElFromSelection(selection);  // 找到 .page 容器
    const pageNumber = +pageEl.dataset.pageNumber;

    const range = selection.getRangeAt(0);
    const selectionRange = this.getTextSelectionRange(pageEl, range);
    return { page: pageNumber, selection: selectionRange };
}

getTextSelectionRange(pageEl: HTMLElement, range: Range) {
    // 关键:找到 startContainer/endContainer 所在 .textLayerNode (每个 item 一个)
    const startTextLayerNode = getTextLayerNode(pageEl, range.startContainer);
    const endTextLayerNode = getTextLayerNode(pageEl, range.endContainer);
    
    const beginIndex = +startTextLayerNode.dataset.idx;  // textDiv 的 data-idx 属性
    const endIndex = +endTextLayerNode.dataset.idx;
    const beginOffset = getOffsetInTextLayerNode(startTextLayerNode, range.startContainer, range.startOffset);
    const endOffset = getOffsetInTextLayerNode(endTextLayerNode, range.endContainer, range.endOffset);
    
    return { beginIndex, beginOffset, endIndex, endOffset };
}
```

**关键依赖**:
- `getTextLayerNode(pageEl, node)` — 找到包含 node 的 `.textLayerNode` 元素(utils/index.ts:147-160)
- `getOffsetInTextLayerNode(textLayerNode, node, offsetInNode)` — 把 DOM Range 的 offset 转换成 textLayerNode 内的字符 offset(utils/index.ts:166-178)
- `textDiv.dataset.idx` — 这是 PDF.js 渲染 textLayer 时自动加的,**关键属性**!

**对我们的价值**:我们现在的 PdfjsBookReader 的 `textLayer` 是我们自己拼的 `<span>`,没有 `dataset.idx`,没法用这套算法。但我们可以**在 span 上加 `data-idx`** 然后直接复制这套算法过来。

### 3.5 矩形 → DOM 高亮层

**文件**:`src/lib/highlights/viewer.ts`(viewer.ts:15-37)

```typescript
placeRectInPage(rect: Rect, page: PDFPageView) {
    const viewBox = page.pdfPage.view;  // [pageX, pageY, pageWidth, pageHeight]
    const [pageX, pageY, pageWidth, pageHeight] = [viewBox[0], viewBox[1], viewBox[2]-viewBox[0], viewBox[3]-viewBox[1]];

    // PDF 坐标系 y 朝上 → 屏幕坐标系 y 朝下
    const mirroredRect = window.pdfjsLib.Util.normalizeRect([
        rect[0], 
        viewBox[3] - rect[1] + viewBox[1],  // 注意翻转
        rect[2], 
        viewBox[3] - rect[3] + viewBox[1]
    ]);

    const rectEl = layerEl.createDiv('pdf-plus-backlink');
    rectEl.setCssStyles({
        left:   `${100 * (mirroredRect[0] - pageX) / pageWidth}%`,
        top:    `${100 * (mirroredRect[1] - pageY) / pageHeight}%`,
        width:  `${100 * (mirroredRect[2] - mirroredRect[0]) / pageWidth}%`,
        height: `${100 * (mirroredRect[3] - mirroredRect[1]) / pageHeight}%`,
    });
    return rectEl;
}
```

**对我们的价值**:渲染高亮的 CSS 模板。用 `%` 定位,不依赖具体 px,缩放后自动跟随。

### 3.6 QuadPoints ↔ Rect 转换

**文件**:`src/utils/index.ts`(utils/index.ts:36-69) + `src/lib/highlights/geometry.ts`(geometry.ts:122-127)

```typescript
// PDF.js 的 quadPoints (8 个数一组) → [left, bottom, right, top]
export function pdfJsQuadPointsToArrayOfRects(quadPoints): Array<Rect> {
    for (let i = 0; i < quadPoints.length; i += 8) {
        const [x1, y1, x2, y2, x3, y3, x4, y4] = quadPoints.slice(i, i + 8);
        rects.push([
            Math.min(x1, x2, x3, x4),
            Math.min(y1, y2, y3, y4),
            Math.max(x1, x2, x3, x4),
            Math.max(y1, y2, y3, y4)
        ]);
    }
}

// Rect 数组 → quadPoints (注意 PDF spec 写错了顺序!)
rectsToQuadPoints(rects: Rect[]): number[] {
    return rects.flatMap(([left, bottom, right, top]) => 
        [left, top, right, top, left, bottom, right, bottom]
    );
}
```

**对我们的价值**:如果以后要直接改 PDF 文件(模式 B),这两个函数必备。

---

## 4. 复用 / 不复用 / 怎么复用的决策

### 4.1 ❌ 不能复用(因为它绑死在 Obsidian 私有 API)

- `src/patchers/*` — 全部是 monkey-patch,搬不动
- `src/main.ts` — Obsidian 插件入口
- `src/lib/commands.ts` — 命令注册,和 Obsidian 命令系统耦合
- `src/lib/workspace-lib.ts` — workspace 集成
- 依赖 `@cantoo/pdf-lib` 的写回 PDF 功能(我们用不上,模式 A 不需要)

### 4.2 ✅ 可以直接复制(MIT,纯算法,无副作用)

| PDF++ 文件 | 函数 | 行数 | 我们的目标位置 |
|---|---|---|---|
| `src/lib/highlights/geometry.ts` | `computeMergedHighlightRects` + 辅助函数 | ~130 | `src/core/pdf/highlight-geometry.ts` (新文件) |
| `src/lib/highlights/extract.ts` | `getTextByRect` | ~20 | 同上 |
| `src/utils/index.ts` | `parsePDFSubpath`, `subpathToParams`, `paramsToSubpath` | ~30 | `src/core/pdf/subpath.ts` (新文件) |
| `src/utils/index.ts` | `getTextLayerNode`, `getOffsetInTextLayerNode` | ~30 | `src/core/pdf/selection.ts` (新文件) |
| `src/lib/highlights/viewer.ts` | `placeRectInPage` | ~25 | `src/core/pdf/render-highlight.ts` (新文件) |
| `src/utils/index.ts` | `toSingleLine` (处理多行文本 + CJK) | ~15 | `src/core/pdf/text-utils.ts` |

**总代码量:~250 行**。加上我们的 wrapper,大概 400 行能搞定"PDF 高亮 + 双链"的完整链路。

### 4.3 ✅ 可以用现成 pdfjs API 替代(不需要抄代码)

| 我们要的能力 | 直接用 pdfjs-dist 6.1.200 |
|---|---|
| **TOC 大纲** | `await pdfDoc.getOutline()` 返回 `PDFOutlineNode[]` |
| **页面标签** (Roman 数字 / "第 1 章") | `pdfViewer.pdfDocument.getPageLabels()` |
| **命名目标** (named destination) | `pdfDoc.getDestination(id)` |
| **现有 PDF annotation 读取** | `page.getAnnotations()` |
| **页面内文本+坐标** | `page.getTextContent({ includeChars: true })` (Obsidian 内部用的就是这个) |

### 4.4 不需要改的(我们已经更好)

- 缩放:`PdfjsSession.setScale / setFitWidth / currentScale / isFitWidth` 已经实现
- 单页渲染 + HiDPI:已经 OK(`507e9a8` 修了 setTransform bug)
- 翻页动画:暂时不需要,P3 级

---

## 5. 可执行方案

### 方案 A(推荐):**不切换引擎**,复制 PDF++ 的核心算法,~2-3 天工作量

#### Step 1:扩 BookReader port(让 selection 携带 4-tuple)

```typescript
// src/core/ports/BookReader.ts
export interface PdfSelection {
  readonly page: number;
  readonly beginIndex: number;
  readonly beginOffset: number;
  readonly endIndex: number;
  readonly endOffset: number;
  readonly text: string;
}

export interface ReaderEventMap {
  relocate: CustomEvent<{ fraction?: number; locator?: string }>;
  "selection-change": CustomEvent<PdfSelection>;  // 改这里
  close: Event;
}
```

#### Step 2:复制 PDF++ 的 selection 算法到 `src/core/pdf/`

新建 4 个文件(每个文件头加 MIT 版权):

**`src/core/pdf/subpath.ts`**:
```typescript
// Copied from RyotaUshio/obsidian-pdf-plus (MIT)
// src/utils/index.ts:228-249
export interface PdfSelectionParams {
  beginIndex: number; beginOffset: number;
  endIndex: number; endOffset: number;
}

export interface ParsedSubpath {
  type: 'page', page: number
} | { type: 'selection', page: number, ...PdfSelectionParams }
   | { type: 'annotation', page: number, annotation: string };

export function parsePDFSubpath(subpath: string): ParsedSubpath | null { /* 复制 */ }
export function paramsToSubpath(params: Record<string, any>): string { /* 复制 */ }
export function subpathToParams(subpath: string): URLSearchParams { /* 复制 */ }
```

**`src/core/pdf/highlight-geometry.ts`**:
复制 `computeMergedHighlightRects` + `computeHighlightRectForItemFromChars` + `computeHighlightRectForItemFromTextLayer` + `areRectanglesMergeableHorizontally/Vertically` + `mergeRectangles`。~130 行。

**`src/core/pdf/selection.ts`**:
复制 `getTextLayerNode`, `getOffsetInTextLayerNode`, `getNodeAndOffsetOfTextPos`, `getCharacterBoundingBoxes`, `getTextLayerInfo`。再加一个 `selectionToTextRange(selection, pageEl, textDivs)` 把 DOM Selection 变成 `PdfSelectionParams`。

**`src/core/pdf/text-utils.ts`**:
`toSingleLine(str)` — 处理多行 / CJK。

#### Step 3:改 PdfjsBookReader

```typescript
// src/adapters/pdfjs/PdfjsBookReader.ts
import { computeMergedHighlightRects, type Rect, type MergedRect } from '../../core/pdf/highlight-geometry';
import { selectionToTextRange } from '../../core/pdf/selection';

class PdfjsSession {
  // 在 text layer 渲染时给每个 span 加 data-idx
  private async renderTextLayer(page: PdfPage, viewport: PdfViewport, ...) {
    const content = await page.getTextContent({ includeChars: true } as any);
    for (let i = 0; i < content.items.length; i++) {
      const item = content.items[i];
      // ...
      const span = this.textLayer.createEl('span', { text: item.str + (item.hasEOL ? '\n' : ' ') });
      span.dataset.idx = String(i);  // ★ 关键!PDF++ 的算法依赖这个
      // ...
    }
    // 缓存 textDivs 和 items 给后续用
    this.textLayerCache = { textDivs, items: content.items };
  }

  // selection-change 改为发 4-tuple
  on(event: 'selection-change', handler) {
    const wrapped = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) return;
      const pageEl = this.textLayer.closest('.ez-reader__pdf-page');
      const range = sel.getRangeAt(0);
      const selectionRange = selectionToTextRange(range, pageEl, this.textLayerCache.textDivs);
      if (!selectionRange) return;
      handler({ ...selectionRange, text: sel.toString().trim(), page: this.currentPage });
    };
    // 注意:selectionchange 事件要在 document 上听
    document.addEventListener('selectionchange', wrapped);
    return () => document.removeEventListener('selectionchange', wrapped);
  }

  // 新方法:跳转到 4-tuple 位置并高亮
  async goToSelection(page: number, sel: PdfSelectionParams): Promise<void> {
    await this.gotoPage(page);
    const { textDivs, items } = this.textLayerCache;
    const rects = computeMergedHighlightRects({ textDivs, textContentItems: items }, 
      sel.beginIndex, sel.beginOffset, sel.endIndex, sel.endOffset);
    this.renderHighlightOverlay(page, rects);  // 临时高亮
  }

  // 新方法:把当前 selection 渲染成高亮(用于"已存高亮"的回显)
  async renderBacklinks(backlinks: PdfSelectionParams[]): Promise<void> {
    // 扫描本页所有 backlinks,算 rects,插 .ez-reader__pdf-highlight-layer
  }
}
```

#### Step 4:UI 加"复制为 Obsidian 链接"

```typescript
// src/ui/reader/ReaderSelectionMenu.ts
class ReaderSelectionMenu {
  private addCopyAsObsidianLinkButton() {
    const btn = this.root.createEl('button', { text: '复制为链接', attr: { type: 'button' } });
    btn.addEventListener('click', () => {
      const sel = this.pendingSelection;
      if (!sel) return;
      const subpath = paramsToSubpath({
        page: sel.page,
        selection: `${sel.beginIndex},${sel.beginOffset},${sel.endIndex},${sel.endOffset}`,
      });
      const link = `[[${this.bookPath}${subpath}|${sel.text.slice(0, 30)}…]]`;
      void navigator.clipboard.writeText(link);
      new Notice('已复制 Obsidian 链接');
    });
  }
}
```

#### Step 5:写笔记功能串联

```typescript
// 在 ReaderView.addExcerpt 里
async addExcerptAtSelection(sel: PdfSelection) {
  const subpath = paramsToSubpath({
    page: sel.page,
    selection: `${sel.beginIndex},${sel.beginOffset},${sel.endIndex},${sel.endOffset}`,
  });
  const excerpt: Excerpt = {
    id: `ex-${Date.now()}`,
    bookId: this.entry.book.id,
    text: sel.text,
    locator: {
      position: { kind: 'reflow', fraction: (sel.page - 1) / this.pageCount, cfi: subpath },
      chapter: ''
    },
    // ...
  };
  await this.deps.reading.addExcerpt(excerpt);
}
```

**效果**:用户在 PDF 里选中一段 → 点"复制为链接" → 粘贴到任何 markdown 文件里 → Ctrl+点击链接 → PDF 跳到那一段,临时高亮。

---

### 方案 B(可选,P2):**加 TOC + 反向链接高亮回显**

- 用 `pdfDoc.getOutline()` 拿大纲 → 在工具栏加"目录"按钮
- 维护 `backlinks: Map<pdfPath, PdfSelectionParams[]>` → 打开 PDF 时,渲染 vault 里所有指向这个 PDF 的 markdown 反向链接(纯高亮,不写 PDF)
- 这部分 PDF++ 用了 `PDFBacklinkIndex` (~360 行),逻辑不复杂但代码量大;**简单版 100 行就能起步**

---

### 方案 C(不推荐):**完全切换到 PDF++**

- **不行**。PDF++ 是 Obsidian 私有 API 的 monkey-patch,绑死在 `pdf-container` 内部。我们的 ReaderView 不在 Obsidian PDF leaf 里。
- 如果想用 PDF++ 的功能,唯一方式 = 让用户**同时安装 PDF++ 插件**,我们的 reader 检测到 PDF++ 已安装就调用 `app.plugins.plugins['pdf-plus'].lib.xxx()`。
- 这种方案优点:零代码复用 PDF++ 全部能力。缺点:**依赖用户额外装插件**;**版本不匹配会崩**;我们完全失去 PDF 渲染控制权。
- **不推荐**,除非用户明确要求。

---

## 6. 工作量估计

| 任务 | 工作量 | 风险 |
|---|---|---|
| Step 1:扩 BookReader port | 0.5h | 无 |
| Step 2:复制 PDF++ 核心 4 文件 + LICENSE 头 | 1.5h | 低(都是纯算法,无副作用) |
| Step 3:改 PdfjsBookReader 加 4-tuple + renderHighlightOverlay | 3-4h | 中(textLayer 缓存要小心 invalidate) |
| Step 4:UI 加"复制为链接"按钮 | 1h | 无 |
| Step 5:串联 addExcerpt 写笔记 | 1h | 无 |
| **小计** | **~1 天** | |
| 单元测试(highlight-geometry / subpath) | 2h | 低 |
| 集成测试(在 Obsidian 里跑) | 2h | 中 |
| **总计** | **~1.5 - 2 天** | |

对比:完全重写(不抄 PDF++ 代码)至少 4-5 天,而且几何算法大概率有 bug(中文换行、CJK 字符宽度、行内合并等细节多)。

---

## 7. 风险和注意点

### 7.1 MIT License 合规

- ✅ 可以复制
- ✅ 可以修改
- ⚠️ **每个复制过来的文件顶部必须加 copyright + license 声明**(PDF++ 的 LICENSE 也要放进 `LICENSES/` 目录)
- ⚠️ 修改过的代码**不需要**开源(因为是 MIT,不是 GPL),但 license 头不能删
- 标准写法:
  ```typescript
  /**
   * Originally from RyotaUshio/obsidian-pdf-plus (MIT License)
   * Copyright (c) 2023 Ryota Ushio
   * https://github.com/RyotaUshio/obsidian-pdf-plus
   * 
   * Modified for ez-reader.
   */
  ```

### 7.2 PDF.js 版本差异

PDF++ 用 `pdfjs-dist@^5.4.54`,我们用 `pdfjs-dist@6.1.200`。
- `getTextContent({ includeChars: true })` 在两边都支持(我们用的是 `legacy` build,这个特性可能没有 — **必须验证**)
- 如果 `legacy` build 不支持 `includeChars`,fallback 到 `computeHighlightRectForItemFromTextLayer`(用 DOM Range 反推),精度差一点但能用

### 7.3 textDiv.dataset.idx 是关键

PDF.js 在 textLayer 里会自动给每个 `<span class="textLayerNode">` 加 `data-idx` 属性。我们现在 PdfjsBookReader 自己拼 span,**没加这个属性**。Step 3 必须补上。

### 7.4 单元测试 mock

`core/pdf/highlight-geometry.ts` 是纯函数,可以脱离 Obsidian 测试。建议复制 PDF++ 的单元测试(他们有 `tests/` 目录,看 `src/lib/highlights/geometry.test.ts` 之类的)。

---

## 8. 一句话结论 + 推荐路径

**不切换引擎,只抄 250 行 PDF++ 核心算法,1.5 天实现"PDF 高亮 + Obsidian 双链"。**

具体动作为:

1. 先让用户测试 `507e9a8` 确认 PDF 能打开(P0 任务)
2. 新建 `src/core/pdf/` 目录,放 4 个新文件(全带 MIT 头)
3. 改 `BookReader.ts` 的 `ReaderEventMap["selection-change"]` 多带 4-tuple
4. 改 `PdfjsBookReader.ts`:`getTextContent({ includeChars: true })`、span 加 `data-idx`、`selectionchange` 监听、发 4-tuple
5. 加 `goToSelection(page, sel)` 方法,在 PDF 跳转后临时高亮
6. `ReaderSelectionMenu` 加"复制为 Obsidian 链接"按钮
7. `addExcerpt` 接收 4-tuple 写入 `locator.cfi`
8. 单元测试 + 在 Obsidian 里测试

完成后用户体验:✅ 选中文字 → 一键复制成 `[[file.pdf#page=1&selection=4,0,5,20]]` → 粘贴到笔记 → 点击链接跳回原文 + 临时高亮。**和 PDF++ 一样的双链能力**,而且不依赖任何额外插件。

---

## 9. 参考资料(全部可访问)

- PDF++ 仓库: <https://github.com/RyotaUshio/obsidian-pdf-plus>
- PDF++ README: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/README.md>
- 高亮核心算法: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/src/lib/highlights/geometry.ts>
- 高亮提取(反向): <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/src/lib/highlights/extract.ts>
- Subpath 解析: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/src/utils/index.ts> (行 218-249)
- 链接复制: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/src/lib/copy-link.ts>
- 高亮渲染: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/src/lib/highlights/viewer.ts>
- License: <https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/LICENSE> (MIT)
