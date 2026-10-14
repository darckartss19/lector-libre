import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WindowsSpeechEngine } from "../src/adapters/windows-speech.mjs";

function completion(engine, id, timeout = 30000) {
  let listener;
  let timer;
  const events = [];
  const promise = new Promise((resolve, reject) => {
    listener = (message) => {
      if (message.id !== id) return;
      events.push(message);
      if (message.type === "completed") {
        cleanup();
        resolve({ ...message, events });
      }
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("No terminó la síntesis de prueba de " + id + "."));
    }, timeout);
    engine.on("event", listener);
  });
  function cleanup() {
    clearTimeout(timer);
    engine.off("event", listener);
  }
  return { promise, cleanup };
}

async function audioFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await audioFiles(path)));
    else if (/\.(?:wav|mp3|pcm|raw)$/iu.test(entry.name)) found.push(path);
  }
  return found.sort();
}

test(
  "El motor nativo enumera voces y sintetiza sin archivo ni salida audible durante la prueba",
  { skip: process.platform !== "win32", timeout: 35000 },
  async () => {
    const engine = await WindowsSpeechEngine.open({ silent: true });
    try {
      const voices = await engine.voices();
      assert.ok(voices.length > 0);
      assert.ok(voices.every((v) => v.id && v.language));
      const events = [];
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("No terminó la síntesis de prueba.")),
          10000,
        );
        engine.on("event", (message) => {
          if (message.id !== "test-1") return;
          events.push(message);
          if (message.type === "completed") {
            clearTimeout(timer);
            resolve(message);
          }
        });
      });
      await engine.speak({
        id: "test-1",
        text: "Una prueba de lectura en español.",
        voice:
          voices.find((v) => v.language.startsWith("es"))?.id || voices[0].id,
      });
      const result = await completed;
      assert.equal(result.cancelled, false);
      assert.equal(result.error, null);
      assert.ok(events.some((e) => e.type === "started"));
      assert.ok(
        events.some((e) => e.type === "progress" && Number.isInteger(e.offset)),
      );
      await assert.rejects(
        engine.speak({
          id: "bad",
          text: "Texto.",
          voice: "voz inexistente",
          rate: 1,
        }),
      );
    } finally {
      await engine.close();
    }
  },
);

const neuralDirectory =
  process.env.LECTOR_NEURAL_TEST_DIR ||
  fileURLToPath(new URL("../work/neural-voices/", import.meta.url));
const neuralModelsAvailable = ["es_ES-davefx-medium", "es_MX-ald-medium"].every(
  (key) => existsSync(join(neuralDirectory, key, key + ".onnx")),
);

test(
  "Piper sintetiza con voces españolas verificadas, cancela y retoma sin guardar audio",
  {
    skip: process.platform !== "win32" || !neuralModelsAvailable,
    timeout: 120000,
  },
  async (context) => {
    const catalog = JSON.parse(
      await readFile(
        new URL("../native/windows/voice-catalog.json", import.meta.url),
        "utf8",
      ),
    );
    const spanishVoices = catalog.voices.filter(
      (voice) =>
        voice.language.startsWith("es-") &&
        existsSync(join(neuralDirectory, voice.key, voice.key + ".onnx")),
    );
    assert.ok(spanishVoices.length >= 2);
    for (const voice of spanishVoices) {
      const model = await readFile(
        join(neuralDirectory, voice.key, voice.key + ".onnx"),
      );
      assert.equal(
        createHash("sha256").update(model).digest("hex"),
        voice.modelSha256,
      );
      const config = await readFile(
        join(neuralDirectory, voice.key, voice.key + ".onnx.json"),
      );
      assert.equal(
        createHash("sha256").update(config).digest("hex"),
        voice.configSha256,
      );
    }
    const before = await audioFiles(neuralDirectory);
    const engine = await WindowsSpeechEngine.open({
      silent: true,
      voicesDirectory: neuralDirectory,
    });
    const pending = [];
    try {
      const voices = await engine.voices();
      for (const expected of spanishVoices) {
        const installed = voices.find((voice) => voice.id === expected.id);
        assert.ok(installed, expected.id + " debe aparecer como instalada.");
        assert.equal(installed.engine, "piper");
        assert.equal(installed.language, expected.language);
        const id = "neural-" + expected.key;
        const finished = completion(engine, id);
        pending.push(finished);
        await engine.speak({
          id,
          text: "Mañana leeré una página. Árbol, alegría y corazón: ¿qué canción escucháis?",
          voice: installed.id,
          rate: 1.1,
        });
        const result = await finished.promise;
        assert.equal(result.cancelled, false);
        assert.equal(result.error, null);
        assert.ok(result.events.some((event) => event.type === "started"));
        assert.ok(
          result.events.some(
            (event) => event.type === "progress" && event.offset === 0,
          ),
        );
      }
      const voice = voices.find((item) => item.id === catalog.voices[0].id).id;
      const interrupted = completion(engine, "neural-interrupted");
      pending.push(interrupted);
      await engine.speak({
        id: "neural-interrupted",
        text: "Una página en español, sin saltar las palabras pendientes. ".repeat(
          60,
        ),
        voice,
      });
      await engine.cancel();
      assert.equal((await interrupted.promise).cancelled, true);
      const resumed = completion(engine, "neural-resumed");
      pending.push(resumed);
      await engine.speak({
        id: "neural-resumed",
        text: "Una página en español, sin saltar las palabras pendientes.",
        voice,
        rate: 0.9,
      });
      const result = await resumed.promise;
      assert.equal(result.cancelled, false);
      assert.equal(result.error, null);
      await assert.rejects(
        engine.speak({
          id: "neural-missing",
          text: "Texto.",
          voice: "piper:missing",
        }),
        /descargada/u,
      );
      await assert.rejects(
        engine.speak({ id: "neural-rate", text: "Texto.", voice, rate: 0.01 }),
        /velocidad/u,
      );
    } finally {
      pending.forEach((item) => item.cleanup());
      await engine.close();
    }
    assert.deepEqual(await audioFiles(neuralDirectory), before);
    context.diagnostic(
      "Voces verificadas y sintetizadas: " +
        spanishVoices.map((voice) => voice.name).join(", "),
    );
  },
);
