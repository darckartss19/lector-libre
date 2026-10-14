import assert from "node:assert/strict";
import test from "node:test";
import { runtimePolicy } from "../src/core/runtime-policy.mjs";

test("mobile and low-memory devices retain a smaller working set", () => {
  const desktop = runtimePolicy();
  const phone = runtimePolicy({ mobile: true });
  assert.equal(phone.libraryPageSize, 24);
  assert.equal(desktop.libraryPageSize, 60);
  assert.ok(phone.coverBytes < desktop.coverBytes);
  assert.ok(phone.pdfPixels < desktop.pdfPixels);
  assert.equal(runtimePolicy({ deviceMemory: 2 }).pdfPixels, phone.pdfPixels);
});
