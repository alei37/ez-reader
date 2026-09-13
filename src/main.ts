// Polyfills must run before any code that depends on them. foliate-js 1.0.1
// uses Object.groupBy and Map.groupBy, and pdfjs-dist 6.1.200 uses
// Promise.withResolvers / ReadableStream async iteration, all of which are
// missing from legacy Android WebViews. Keep this import first.
import "./platform/polyfills";

import EzReaderPlugin from "./Plugin";

export default EzReaderPlugin;
