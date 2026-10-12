#!/usr/bin/env node
/**
 * Fail the build when manifest.json and package.json disagree on the
 * version.
 *
 * Why this exists: `package.json` sat at 0.2.0 for eight releases after the
 * last real bump, because only `manifest.json` gets bumped (the release
 * workflow reads the version from there via `jq`). Nothing compared the two,
 * so the drift was invisible until someone read `package.json` expecting it
 * to be authoritative. A release cut from the wrong file — or a bug report
 * citing "0.2.0" when 0.3.1 shipped — is the failure mode this prevents.
 *
 * Also checks that the working tree's `manifest.json` version matches the
 * tag being released, when run from CI with the ref available.
 */
import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");

const errors = [];

if (pkg.version !== manifest.version) {
  errors.push(
    `version mismatch: manifest.json=${manifest.version} but package.json=${pkg.version}`
  );
}

// The release workflow tags `X.Y.Z` or `vX.Y.Z`; catching a mismatch here
// fails the build instead of publishing a release under the wrong tag.
const ref = process.env.GITHUB_REF_NAME;
if (ref && /^\d+\.\d+\.\d+/.test(ref)) {
  const tagged = ref.replace(/^v/, "");
  if (tagged !== manifest.version) {
    errors.push(
      `tag ${ref} does not match manifest.json version ${manifest.version}`
    );
  }
}

if (errors.length > 0) {
  console.error("[ez-reader] version check failed:\n  - " + errors.join("\n  - "));
  process.exit(1);
}

console.log(`[ez-reader] version check ok: ${manifest.version}`);