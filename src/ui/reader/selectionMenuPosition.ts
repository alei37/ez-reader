/**
 * 选词菜单位置算法 — 纯函数, 可单测.
 *
 * 设计目标:
 * 1. 菜单水平居中放在选区中心 (不是左边缘 — 对居中列里的选词体验提升最大)
 * 2. 视口左右约束: 不超出 viewport 边距
 * 3. 垂直优先下方; 下方空间不够才放上方
 * 4. 多行选区 (height > 单行): 改放上方, 避免菜单盖住选中的最后一行文字
 * 5. RTL: 水平方向不变 (居中即可), 但保留 hook 方便后续扩展
 */

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface MenuPosition {
  readonly top: number;
  readonly left: number;
  /** 调试/可观测性 — 选了哪个分支 */
  readonly placement: "below" | "above";
}

export interface PositionOptions {
  /** 视口边距, 默认 8px */
  readonly margin?: number;
  /** 菜单与选区的间距, 默认 6px */
  readonly gap?: number;
  /** 单行阈值 (高度) — 超过这个高度视为多行选区, 默认 28px (单行文字大约 20-24px) */
  readonly singleLineMaxHeight?: number;
}

/**
 * 计算菜单在视口中的绝对定位 (含 window.scrollX/scrollY).
 *
 * @param rect 选区的 getBoundingClientRect() — 已是 viewport 相对坐标
 * @param menu 菜单的 getBoundingClientRect() — 同样 viewport 相对
 * @param viewport window.innerWidth/innerHeight
 * @param options 调优参数
 */
export const computeSelectionMenuPosition = (
  rect: DOMRect,
  menu: DOMRect,
  viewport: ViewportSize,
  options: PositionOptions = {}
): MenuPosition => {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 6;
  const singleLineMaxHeight = options.singleLineMaxHeight ?? 28;

  const isMultiLine = rect.height > singleLineMaxHeight;

  // 多行选区强制放上方 — 放下方会盖住最后一行选中的内容, 比菜单遮挡
  // 第一行更糟糕 (用户视线焦点通常在选区中段, 上方留白可以接受).
  let placement: "below" | "above";
  if (isMultiLine) {
    placement = "above";
  } else if (rect.bottom + gap + menu.height <= viewport.height - margin) {
    placement = "below";
  } else {
    placement = rect.top - gap - menu.height >= margin ? "above" : "below";
  }

  const baseTop = placement === "below"
    ? rect.bottom + gap
    : rect.top - gap - menu.height;

  // 水平居中, 然后约束到 viewport.
  // 视口坐标 → 文档坐标 (加 scrollX/scrollY) 在 caller 那里做.
  let left = rect.left + rect.width / 2 - menu.width / 2;
  if (left < margin) left = margin;
  if (left + menu.width > viewport.width - margin) {
    left = Math.max(margin, viewport.width - margin - menu.width);
  }

  return {
    top: baseTop,
    left,
    placement
  };
};