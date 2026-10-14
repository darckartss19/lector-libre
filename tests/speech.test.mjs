import test from "node:test";
import assert from "node:assert/strict";
import {
  speechChunk,
  speechFragmentStarts,
  SpeechQueue,
} from "../src/core/speech.mjs";

test("El texto se divide en fragmentos acotados sin perderlo ni generar audio en disco", () => {
  const text =
    "Primera frase. Segunda frase con más palabras.\n" + "texto ".repeat(100);
  let offset = 0,
    reconstructed = "",
    count = 0;
  while (offset < text.length) {
    const chunk = speechChunk(text, offset, 60);
    if (!chunk) {
      reconstructed += text.slice(offset);
      break;
    }
    assert.ok(chunk.text.length <= 60);
    assert.ok(chunk.end > offset);
    reconstructed += text.slice(offset, chunk.start) + chunk.text;
    offset = chunk.end;
    count++;
  }
  assert.equal(reconstructed, text);
  assert.ok(count > 1);
});

test("Los límites no cortan caracteres fuera del plano básico de Unicode", () => {
  const text = "a\u{1f600}b\u{1f600}c";
  let offset = 0,
    result = "";
  while (offset < text.length) {
    const chunk = speechChunk(text, offset, 2);
    result += chunk.text;
    assert.equal(chunk.text.isWellFormed(), true);
    offset = chunk.end;
  }
  assert.equal(result, text);
});

test("Pausar conserva la palabra actual y descarta callbacks atrasados del motor", () => {
  const queue = new SpeechQueue({
    bookId: "book",
    voice: "voz-es",
    chapters: [{ id: "1", text: "Hola mundo. Otra frase." }],
  });
  const first = queue.next();
  queue.progress(first.id, 5);
  const saved = queue.pause();
  assert.equal(saved.offset, 5);
  const resumed = queue.next();
  assert.equal(resumed.text, "mundo. Otra frase.");
  assert.notEqual(resumed.id, first.id);
  assert.equal(queue.complete(first.id), false);
  assert.equal(queue.progress(first.id, 0), false);
  assert.equal(queue.active.id, resumed.id);
});

test("La reproducción solo avanza al terminar un fragmento y pasa entre capítulos", () => {
  const queue = new SpeechQueue({
    bookId: "book",
    voice: "voz-es",
    chapters: [
      { id: "1", text: "Uno." },
      { id: "2", text: "   " },
      { id: "3", text: "Tres." },
    ],
  });
  const one = queue.next();
  assert.deepEqual(queue.next(), one);
  queue.complete(one.id);
  const three = queue.next();
  assert.equal(three.chapter, "3");
  queue.complete(three.id);
  assert.equal(queue.next(), null);
  assert.equal(queue.status, "finished");
  assert.equal(queue.checkpoint().offset, 5);
});

test("La posición se recupera tras reiniciar; un fallo no salta al siguiente capítulo", () => {
  const options = {
    bookId: "book",
    voice: "voz-es",
    rate: 1.3,
    chapters: [
      { id: "1", text: "Uno." },
      { id: "2", text: "Dos palabras." },
    ],
  };
  const queue = new SpeechQueue({
    ...options,
    position: { chapter: "2", offset: 4 },
  });
  const request = queue.next();
  assert.equal(request.text, "palabras.");
  queue.complete(request.id, { error: "Sin voz disponible" });
  assert.equal(queue.status, "error");
  assert.equal(queue.checkpoint().offset, 4);
  const restored = new SpeechQueue({
    ...options,
    position: queue.checkpoint(),
  });
  assert.equal(restored.next().text, "palabras.");
  assert.throws(
    () =>
      new SpeechQueue({ ...options, position: { chapter: "2", offset: 900 } }),
  );
});

test("Elegir una posición invalida callbacks anteriores y conserva caracteres UTF-16 completos", () => {
  const queue = new SpeechQueue({
    bookId: "book",
    voice: "voz-es",
    chapters: [
      { id: "one", text: "Hola \u{1f600}. Después." },
      { id: "two", text: "Final." },
    ],
  });
  const first = queue.next();
  const seek = queue.seek({ chapter: "one", offset: 6 });
  assert.equal(seek.offset, 5);
  assert.equal(queue.status, "paused");
  assert.equal(queue.active, null);
  const second = queue.next();
  assert.equal(second.text, "\u{1f600}. Después.");
  assert.equal(queue.progress(second.id, 1), true);
  assert.equal(
    queue.checkpoint().offset,
    5,
    "An inexact native callback cannot checkpoint half an emoji",
  );
  assert.notEqual(first.id, second.id);
  assert.equal(queue.complete(first.id), false);
  assert.equal(queue.progress(first.id, 10), false);
  assert.equal(queue.active.id, second.id);
  assert.equal(queue.checkpoint().offset, 5);
  assert.throws(() => queue.seek({ chapter: "missing", offset: 0 }));
  assert.throws(() => queue.seek({ chapter: "one", offset: 99 }));
  assert.equal(
    queue.active.id,
    second.id,
    "Invalid positions do not stop the current queue",
  );
});

test("Anterior y siguiente recorren frases y párrafos, cruzando capítulos vacíos", () => {
  const firstText = "  Uno. Dos.\nTres sin punto\nCuatro.",
    finalText = "\u{1f600} Otra. Fin.";
  const queue = new SpeechQueue({
    bookId: "book",
    voice: "voz-es",
    chapters: [
      { id: "one", text: firstText },
      { id: "empty", text: "\n " },
      { id: "last", text: finalText },
    ],
  });
  assert.deepEqual(speechFragmentStarts(firstText), [2, 7, 12, 27]);
  queue.seek({ chapter: "one", offset: 2 });
  const old = queue.next();
  assert.equal(queue.nextFragment().offset, 7);
  const next = queue.next();
  assert.equal(queue.complete(old.id), false);
  assert.equal(queue.active.id, next.id);
  queue.progress(next.id, 2);
  assert.equal(
    queue.previousFragment().offset,
    7,
    "An unfinished phrase restarts at its beginning",
  );
  assert.equal(queue.previousFragment().offset, 2);
  assert.equal(
    queue.previousFragment().offset,
    0,
    "Back at the start stays within the book",
  );
  queue.seek({ chapter: "one", offset: 27 });
  assert.equal(queue.nextFragment().chapter, "last");
  assert.equal(queue.checkpoint().offset, 0);
  assert.equal(queue.previousFragment().chapter, "one");
  assert.equal(queue.checkpoint().offset, 27);
  queue.seek({ chapter: "last", offset: finalText.length });
  assert.equal(queue.previousFragment().offset, 9);
  assert.equal(queue.nextFragment().offset, finalText.length);
  assert.equal(queue.next(), null);
  assert.equal(queue.status, "finished");
});

test("Los extremos vacíos y un salto pausado no reproducen ni modifican otro libro", () => {
  const options = {
    bookId: "same",
    voice: "voz-es",
    chapters: [{ id: "one", text: "Uno. Dos." }],
  };
  const first = new SpeechQueue(options),
    second = new SpeechQueue(options);
  const request = first.next();
  const other = second.next();
  first.pause();
  first.nextFragment();
  assert.equal(first.status, "paused");
  assert.equal(first.active, null);
  assert.equal(second.complete(request.id), false);
  assert.equal(second.active.id, other.id);
  assert.throws(() => first.skipFragment(0));
  const empty = new SpeechQueue({
    ...options,
    chapters: [
      { id: "empty", text: "   " },
      { id: "empty2", text: "" },
    ],
  });
  assert.equal(empty.previousFragment().offset, 0);
  assert.equal(empty.nextFragment().chapter, "empty2");
  assert.equal(empty.next(), null);
  assert.equal(empty.status, "finished");
});
