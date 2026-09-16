/**
 * Ambient declaration for `foliate-js/view.js`. foliate-js 1.0.1 ships
 * without type definitions, so this stub gives us a typed entry point
 * for the dynamic import inside `FoliateBookReader.open`. The actual
 * surface we use is narrowed to a `FoliateModule` interface inside
 * `FoliateBookReader.ts`; this file exists only to satisfy the
 * `tsc --noEmit` check.
 */
declare module "foliate-js/view.js" {
  const view: unknown;
  export = view;
}
