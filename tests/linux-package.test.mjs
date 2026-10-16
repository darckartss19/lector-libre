import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/build-linux.sh", import.meta.url),
);
const base = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const linux = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.linux.conf.json", import.meta.url),
    "utf8",
  ),
);

test("Linux packaging replaces Windows resources with licenses without overriding app security", () => {
  assert.deepEqual(linux.bundle.targets, ["deb"]);
  assert.deepEqual(linux.bundle.resources, {
    "../LICENSE": "LICENSE",
    "../THIRD_PARTY_NOTICES.txt": "THIRD_PARTY_NOTICES.txt",
  });
  assert.equal(linux.app, undefined);
  assert.equal(linux.bundle.windows, undefined);
  assert.equal(linux.bundle.linux.deb.section, "education");
  assert.deepEqual(base.bundle.targets, ["nsis"]);
  assert.ok(base.bundle.resources.includes("../native/windows/*"));
});

test(
  "Linux build help works without build tools or a repository working directory",
  { skip: process.platform !== "linux" },
  () => {
    const result = spawnSync("/bin/bash", [script, "--help"], {
      cwd: "/tmp",
      env: { PATH: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--check/);
    assert.match(result.stdout, /--output-dir/);
  },
);

test(
  "Unsupported build options and incomplete output paths fail before invoking tools",
  { skip: process.platform !== "linux" },
  () => {
    for (const args of [["--features", "drive-sync"], ["--output-dir"]]) {
      const result = spawnSync("/bin/bash", [script, ...args], {
        cwd: "/tmp",
        env: { PATH: "" },
        encoding: "utf8",
      });
      assert.equal(result.status, 2, result.stderr);
    }
    assert.equal(spawnSync("/bin/bash", ["-n", script]).status, 0);
  },
);
