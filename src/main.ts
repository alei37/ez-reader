// Polyfills must run before any code that depends on them. foliate-js 1.0.1
// uses Object.groupBy and Map.groupBy, both of which are missing from
// legacy Android WebViews. Keep this import first.
import "./platform/polyfills";
import { collectPolyfillReport } from "./platform/polyfills";

// Surface missing browser APIs once at startup so triage is easy — the
// report lists which modern Web Platform APIs the current WebView lacks.
// On desktop Electron everything is present; on older Android tablets this
// may show missing Intl.Segmenter or ResizeObserver, which are clues for
// diagnosing white screens.
const polyfillReport = collectPolyfillReport();
if (polyfillReport.missing.length > 0) {
  console.info(
    "[ez-reader] WebView missing APIs (polyfilled where possible):",
    polyfillReport.missing.join(", "),
    "| UA:",
    polyfillReport.userAgent
  );
}

import EzReaderPlugin from "./Plugin";

export default EzReaderPlugin;
