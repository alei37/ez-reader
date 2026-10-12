import test from "node:test";
import assert from "node:assert/strict";

import { redactSecrets, restoreExportedKeys } from "../../src/ui/settings/SettingsTab";
import type { AnnotationSnapshot } from "../../src/core/ports/AnnotationStore";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";

/**
 * The exported backup file is something users email, sync, or commit to a
 * notes repo. `settings.translation.apiKey` is a plaintext credential —
 * for the Google provider it is a full service-account JSON containing a
 * `private_key`. Shipping it in "export my data" is how keys end up in git
 * history, so export blanks it and import keeps the key already in the vault.
 */

const GOOGLE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "my-project",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n",
  client_email: "trans@my-project.iam.gserviceaccount.com"
});

const snapshotWith = (apiKey: string): AnnotationSnapshot =>
  ({
    version: 1,
    settings: {
      uiLocale: "zh-CN",
      translation: {
        providerId: "google-translation-v3",
        apiKey,
        sourceLocale: "auto",
        targetLocale: "zh-CN"
      },
      defaultAppearance: {},
      researchDirectory: "",
      libraryOwnerName: "",
      defaultNoteTemplate: "",
      readerOpenMode: "tab",
      twoPagesByDefault: false,
      immersiveOnTablet: false
    } as unknown as PluginSettings,
    library: ["a", "b"],
    reading: [],
    bookmarks: [],
    excerpts: []
  }) as unknown as AnnotationSnapshot;

test("export: the API key never appears in the serialized output", () => {
  const snapshot = snapshotWith(GOOGLE_SERVICE_ACCOUNT);
  const serialized = JSON.stringify(redactSecrets(snapshot), null, 2);
  assert.ok(!serialized.includes("PRIVATE KEY"), "private key must not be in the export");
  assert.ok(!serialized.includes("gserviceaccount.com"), "client_email must not leak either");
  assert.ok(!serialized.includes("BEGIN PRIVATE KEY"));
});

test("export: redaction does not mutate the live snapshot", () => {
  const snapshot = snapshotWith(GOOGLE_SERVICE_ACCOUNT);
  redactSecrets(snapshot);
  assert.equal(
    snapshot.settings.translation!.apiKey,
    GOOGLE_SERVICE_ACCOUNT,
    "the in-memory snapshot must keep its key — only the exported copy is blanked"
  );
});

test("export: user data survives redaction", () => {
  const snapshot = snapshotWith("secret-key");
  const out = redactSecrets(snapshot);
  assert.deepEqual(out.library, ["a", "b"]);
  assert.equal(out.settings.translation!.providerId, "google-translation-v3");
  assert.equal(out.settings.translation!.targetLocale, "zh-CN");
});

test("import: a redacted export restores the key already in the vault", () => {
  const current = snapshotWith("my-real-key");
  const incoming = redactSecrets(snapshotWith(GOOGLE_SERVICE_ACCOUNT));
  const merged = restoreExportedKeys(incoming, current);
  assert.equal(
    merged.settings.translation!.apiKey,
    "my-real-key",
    "importing a backup must not wipe the key the user already configured"
  );
  assert.equal((merged.settings.translation as Record<string, unknown>).__redactedApiKey, undefined);
});

test("import: a hand-edited file with a real key is NOT overridden", () => {
  const current = snapshotWith("my-real-key");
  const incoming = snapshotWith("key-from-file");
  const merged = restoreExportedKeys(incoming, current);
  assert.equal(merged.settings.translation!.apiKey, "key-from-file");
});

test("import: no translation configured on either side is a no-op", () => {
  const bare = {
    version: 1,
    settings: {} as unknown as PluginSettings,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  } as unknown as AnnotationSnapshot;
  const merged = restoreExportedKeys(bare, bare);
  assert.equal(merged.settings.translation, undefined);
});