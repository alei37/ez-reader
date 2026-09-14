import { test } from "node:test";
import { strict as assert } from "node:assert";

/**
 * Mirror of ObsidianNoteWriter's enqueueWrite logic — we test it without
 * importing the real class because it requires the obsidian runtime
 * (Plugin / App / TFile) at module top, which JSDOM cannot satisfy.
 *
 * The real concern is serialization: two concurrent writes to the same
 * path must not interleave, and a failed write must not poison the
 * queue for subsequent callers.
 */
type WriteFn = () => Promise<void>;

const enqueueWrite = (
  queue: Map<string, Promise<void>>,
  path: string,
  fn: WriteFn
): Promise<void> => {
  const prev = queue.get(path) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queue.set(path, next.catch(() => undefined));
  return next;
};

test("enqueueWrite: serialises two writes to the same path", async () => {
  const queue = new Map<string, Promise<void>>();
  const order: string[] = [];
  const w1 = enqueueWrite(queue, "/note.md", async () => {
    order.push("w1-start");
    await new Promise((r) => globalThis.setTimeout(r, 30));
    order.push("w1-end");
  });
  const w2 = enqueueWrite(queue, "/note.md", async () => {
    order.push("w2-start");
    order.push("w2-end");
  });
  await Promise.all([w1, w2]);
  // 必须严格 w1 完整完成后 w2 才开始
  assert.deepEqual(order, ["w1-start", "w1-end", "w2-start", "w2-end"]);
});

test("enqueueWrite: 不同 path 互不阻塞", async () => {
  const queue = new Map<string, Promise<void>>();
  const order: string[] = [];
  const w1 = enqueueWrite(queue, "/a.md", async () => {
    order.push("a-start");
    await new Promise((r) => globalThis.setTimeout(r, 30));
    order.push("a-end");
  });
  const w2 = enqueueWrite(queue, "/b.md", async () => {
    order.push("b-start");
    order.push("b-end");
  });
  await Promise.all([w1, w2]);
  // a 和 b 应该交错, 而不是 b 等 a
  assert.deepEqual(order, ["a-start", "b-start", "b-end", "a-end"]);
});

test("enqueueWrite: 一个 write 失败不影响后续", async () => {
  const queue = new Map<string, Promise<void>>();
  const w1 = enqueueWrite(queue, "/x.md", async () => {
    throw new Error("intentional");
  });
  await assert.rejects(w1, /intentional/);
  const w2 = enqueueWrite(queue, "/x.md", async () => {
    /* ok */
  });
  await w2; // 不应该挂住
});

test("enqueueWrite: 100 个并发调用最终都完成, 顺序按调用时间", async () => {
  const queue = new Map<string, Promise<void>>();
  const completed: number[] = [];
  const tasks: Promise<void>[] = [];
  for (let i = 0; i < 100; i++) {
    tasks.push(
      enqueueWrite(queue, "/fanout.md", async () => {
        // 模拟小的随机延迟, 让 race 更明显
        await new Promise((r) => globalThis.setTimeout(r, Math.random() * 5));
        completed.push(i);
      })
    );
  }
  await Promise.all(tasks);
  // 100 个全部完成, 顺序应该和调用顺序一致 (串行)
  for (let i = 0; i < 100; i++) {
    assert.equal(completed[i], i, `第 ${i} 个任务应按顺序完成`);
  }
  assert.equal(completed.length, 100);
});
