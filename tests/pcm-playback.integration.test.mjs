import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test(
  "PCM stops before fragment completion and old cleanup cannot cancel new playback",
  {
    skip: process.platform !== "win32",
    timeout: 20000,
  },
  async (context) => {
    const playback = fileURLToPath(
      new URL("../native/windows/PcmPlayback.cs", import.meta.url),
    );
    const fixture = fileURLToPath(
      new URL("./fixtures/pcm-playback-check.cs", import.meta.url),
    );
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const command = `$ErrorActionPreference='Stop'; Add-Type -Path @(${quote(playback)},${quote(fixture)}) -ReferencedAssemblies 'System.Core'; [PcmPlaybackCheck]::Run()`;
    const { stdout } = await promisify(execFile)(
      join(
        process.env.SystemRoot,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 15000 },
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.iterations, 5);
    assert.ok(result.maxCancelMs < 500);
    assert.equal(result.silentSamples, true);
    context.diagnostic(
      `Native buffer cancellation: ${result.maxCancelMs} ms maximum; normal completion: ${result.naturalMs} ms.`,
    );
  },
);
