/**
 * Symmetric to `Disposable` in `vscode-languageserver-protocol`. We don't
 * import the upstream type so the core layer stays free of transitive
 * dependencies; the shape is the common subset.
 */
export interface Disposable {
  dispose(): void;
}

export const disposableFrom = (dispose: () => void): Disposable => ({ dispose });

export const disposeAll = (disposables: ReadonlyArray<Disposable>): void => {
  for (const d of disposables) d.dispose();
};