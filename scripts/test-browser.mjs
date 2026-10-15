import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => /^browser-.*\.mjs$/.test(name))
  .sort();
const failures = [];
for (const suite of suites) {
  console.log(`\nRunning ${suite}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`tests/${suite}`], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) failures.push(suite);
}
console.log(
  `\nBrowser suites: ${suites.length - failures.length}/${suites.length} passed.`,
);
if (failures.length) {
  console.error(`Failed: ${failures.join(", ")}`);
  process.exitCode = 1;
}
