/**
 * Minimal ambient declarations for `foliate-js`. The shipped package has no
 * TypeScript definitions; this file only describes the surface the
 * `FoliateBookReader` adapter uses.
 */
declare module "foliate-js/view.js" {
  export interface FoliateViewOptions {
    docHeight?: number;
  }

  export const makeBook: (input: File) => Promise<unknown>;

  export class View extends HTMLElement {
    open(book: unknown): Promise<void>;
    close(): void;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    init(options: FoliateViewOptions): void;
    destroy(): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
  }
}

declare module "foliate-js/overlayer.js" {
  export const Overlayer: {
    highlight: unknown;
  };
}