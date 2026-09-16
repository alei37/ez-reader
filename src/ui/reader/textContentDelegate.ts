import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import type { ContentDelegate, MountContext } from "./ContentDelegate";

/**
 * ContentDelegate for TXT + MOBI + AZW3. All three formats render through
 * the same `PagedTextSession` (see `src/adapters/text/PagedTextSession.ts`),
 * so a single delegate handles them — the underlying BookReader picks the
 * right parser based on `book.locator.format`.
 *
 * The `engine` passed in is a `formatDispatcher` BookReader (or any
 * BookReader — the delegate doesn't care about format details).
 */
export class TextContentDelegate implements ContentDelegate {
  private readonly engine: BookReader;
  private session: ReaderSession | undefined;

  constructor(engine: BookReader) {
    this.engine = engine;
  }

  async mount(host: HTMLElement, ctx: MountContext): Promise<ReaderSession> {
    if (this.session) {
      throw new Error("[ez-reader] TextContentDelegate.mount called twice without destroy");
    }
    this.session = await this.engine.open(ctx.book, host, ctx.appearance, ctx.loader);
    return this.session;
  }

  async destroy(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    try {
      await session.close();
    } catch (error) {
      console.warn("[ez-reader] TextContentDelegate.destroy failed", error);
    }
  }
}
