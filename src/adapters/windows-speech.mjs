import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Node development adapter to exercise real Windows voices before packaging
// the native app. Android/iOS need their own service and lifecycle adapters.
export class WindowsSpeechEngine extends EventEmitter {
  #child;
  #pending = new Map();
  #counter = 0;
  #errors = "";
  #exited = false;

  static async open({ silent = false, voicesDirectory = null } = {}) {
    if (process.platform !== "win32")
      throw new Error("Este adaptador requiere Windows.");
    const engine = new WindowsSpeechEngine();
    const script = fileURLToPath(
      new URL("../../native/windows/speech-host.ps1", import.meta.url),
    );
    const powershell = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    engine.#child = spawn(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        ...(silent ? ["-Silent"] : []),
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(voicesDirectory
            ? {
                LECTOR_VOICES_DIR: voicesDirectory,
                LECTOR_VOICE_CATALOG: fileURLToPath(
                  new URL(
                    "../../native/windows/voice-catalog.json",
                    import.meta.url,
                  ),
                ),
              }
            : {}),
        },
      },
    );
    engine.#child.stderr.setEncoding("utf8");
    engine.#child.stderr.on("data", (chunk) => {
      engine.#errors = (engine.#errors + chunk).slice(-4000);
    });
    engine.#child.stdin.on("error", (error) => engine.#fail(error));
    engine.#child.on("error", (error) => engine.#fail(error));
    engine.#child.on("exit", (code) => {
      engine.#exited = true;
      engine.#fail(
        new Error(engine.#errors || "El motor de voz terminó (" + code + ")."),
      );
      engine.emit("exit", code);
    });
    const lines = createInterface({ input: engine.#child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/u, ""));
        if (message.type === "response") {
          const pending = engine.#pending.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            engine.#pending.delete(message.requestId);
            message.ok
              ? pending.resolve(message.result)
              : pending.reject(new Error(message.error));
          }
        } else engine.emit("event", message);
      } catch (error) {
        engine.#fail(new Error("Respuesta de voz no válida: " + error.message));
      }
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("El motor de voz no inició a tiempo.")),
          20000,
        );
        const onEvent = (message) => {
          if (message.type === "ready") finish();
        };
        const onFault = (error) => finish(error);
        function finish(error) {
          clearTimeout(timer);
          engine.off("event", onEvent);
          engine.off("fault", onFault);
          error ? reject(error) : resolve();
        }
        engine.on("event", onEvent);
        engine.on("fault", onFault);
      });
    } catch (error) {
      engine.#child.kill();
      throw error;
    }
    return engine;
  }

  #fail(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.emit("fault", error);
  }

  command(action, fields = {}) {
    if (this.#exited)
      return Promise.reject(new Error("El motor de voz está cerrado."));
    const requestId = String(++this.#counter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("El motor de voz no respondió a " + action + "."));
      }, 10000);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.#child.stdin.write(
        JSON.stringify({ ...fields, action, requestId }) + "\n",
        "utf8",
      );
    });
  }

  voices() {
    return this.command("voices");
  }
  speak({ id, text, voice, rate = 1 }) {
    return this.command("speak", { id, text, voice, rate });
  }
  pause() {
    return this.command("pause");
  }
  resume() {
    return this.command("resume");
  }
  cancel() {
    return this.command("cancel");
  }

  async close() {
    if (this.#exited) return;
    const exited = new Promise((resolve) => this.#child.once("exit", resolve));
    try {
      await this.command("shutdown");
      this.#child.stdin.end();
    } catch {
      this.#child.kill();
    }
    const timer = setTimeout(() => this.#child.kill(), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
