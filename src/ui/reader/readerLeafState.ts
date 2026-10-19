/**
 * v0.3.3: 阅读器 leaf 的状态匹配 —— 纯函数, 不 import obsidian。
 *
 * 单独成文件而不是塞进 Plugin.ts, 有两个理由:
 *  1. 可测。`Plugin.ts` 一 import 就把整个 foliate-js / pdf-plus 世界
 *     拖进来, 测试环境里起不来; 这个判断本身却是个三行的纯逻辑。
 *  2. 分层。`ui/` 下不该出现"只有 Plugin 用得上所以放 Plugin 里"的
 *     隐式耦合 —— 它的语义属于 reader view 家族。
 */

/**
 * 这个 leaf 显示的是不是 `bookId`?
 *
 * 要在两个**可能不一致**的来源之间做仲裁:
 *  1. `view.getCurrentBookId()` —— view 实例内存里的真相。`setEntry` 是
 *     纯内存操作, 用户在同一个 leaf 里从 A 换到 B 之后, layout 里存的
 *     还是 A。
 *  2. `layoutState.file` —— Obsidian 记在 workspace 里的最后一次存档。
 *     ReaderView v0.3.3 之前没有 `getState()`, 这个值压根不存在; 有了
 *     之后它只在 Obsidian 主动存档时才更新。
 *
 * 顺序不能反: 先问 view, 因为它一定比 layout 新。view 拿不到书 (leaf 还没
 * 创建出 view 实例, 或者 restore 途中) 才退回 layout。只查 layout 会漏掉
 * "刚切过书"的场景 —— 那正是用户在 obsidian:// 协议路径上最常遇到的:
 * 他开着 A, 点 B 笔记里的"返回原文", openReader 已经把 leaf 切到 B 了,
 * layout 还写着 A。
 */
export const readerLeafMatchesBook = (
  layoutState: unknown,
  viewBookId: string | undefined,
  bookId: string
): boolean => {
  if (typeof viewBookId === "string" && viewBookId.length > 0) {
    return viewBookId === bookId;
  }
  if (!layoutState || typeof layoutState !== "object" || Array.isArray(layoutState)) return false;
  const file = (layoutState as { file?: unknown }).file;
  return typeof file === "string" && file === bookId;
};
