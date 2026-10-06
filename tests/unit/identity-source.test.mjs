// The oai-authenticated-user-* headers are trusted only where something in
// front of the Worker owns them: the Sites hosting dispatcher (runtime
// ATLAS_DEPLOYMENT=hosted) or the vite dev shim (compile-time serve flag),
// which strips inbound copies. Anything else fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isIdentityHeaderTrusted } from "../../lib/identity-source.ts";

test("a built Worker with ATLAS_DEPLOYMENT unset does not trust identity headers", () => {
  assert.equal(isIdentityHeaderTrusted({ devShim: false, deployment: undefined }), false);
  assert.equal(isIdentityHeaderTrusted({ devShim: false, deployment: "" }), false);
});

test("the Sites-hosted deployment trusts identity headers", () => {
  assert.equal(isIdentityHeaderTrusted({ devShim: false, deployment: "hosted" }), true);
});

test("the vite dev shim trusts identity headers", () => {
  assert.equal(isIdentityHeaderTrusted({ devShim: true, deployment: undefined }), true);
});

test("only the exact value 'hosted' counts", () => {
  for (const deployment of ["Hosted", "hosted ", " hosted", "HOSTED", "self-hosted", "true", "1"]) {
    assert.equal(
      isIdentityHeaderTrusted({ devShim: false, deployment }),
      false,
      `deployment ${JSON.stringify(deployment)} must not be trusted`,
    );
  }
});

test("a non-boolean dev-shim flag does not count as the shim", () => {
  for (const devShim of ["true", 1, "serve", undefined, null]) {
    assert.equal(isIdentityHeaderTrusted({ devShim, deployment: undefined }), false);
  }
});
