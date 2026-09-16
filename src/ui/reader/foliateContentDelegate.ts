import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import type { ContentDelegate, MountContext } from "./ContentDelegate";

/**
 * ContentDelegate for EPUB, backed by foliate-js via {@link BookReader}.
 * Thin wrapper today; the value of routing through ContentDelegate (vs.
 * holding a `BookReader` directly in ReaderView) is that future PDF support
 * can plug in a different delegate without ReaderView learning any
 * format-specific knowledge.
 */
export class FoliateContentDelegate implements ContentDelegate {
  private readonly engine: BookReader;
  private session: ReaderSession | undefined;

  constructor(engine: BookReader) {
    this.engine = engine;
  }

  async mount(host: HTMLElement, ctx: MountContext): Promise<ReaderSession> {
    if (this.session) {
      throw new Error("[ez-reader] FoliateContentDelegate.mount called twice without destroy");
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
      console.warn("[ez-reader] FoliateContentDelegate.destroy failed", error);
    }
  }
}
