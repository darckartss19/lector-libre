import test from "node:test";
import assert from "node:assert/strict";
import { nativeAudioQueue } from "../src/core/native-audio.mjs";
import { settingsMarkup } from "../src/settings.mjs";

test("Android checkpoints resume from native UTF-16 offsets without copying chapter text", () => {
  const state = {
    hasProgram: true,
    bookId: "a".repeat(64),
    chapter: "second",
    offset: 14,
    voice: "android:offline",
    rate: 1.25,
    active: { chapter: "second", start: 10, end: 30, text: "Current fragment" },
  };
  const queue = nativeAudioQueue(state);
  assert.deepEqual(queue.checkpoint(), {
    chapter: "second",
    offset: 14,
    voice: state.voice,
    rate: 1.25,
  });
  assert.deepEqual(queue.chapters, [{ id: "second" }]);
  assert.equal(queue.active, state.active);
  assert.equal(nativeAudioQueue({ ...state, hasProgram: false }), null);
});
test("Android voice settings offer the phone installer without Windows or Piper downloads", () => {
  const html = settingsMarkup({}, [], [], { android: true });
  assert.match(html, /data-action="voice-settings"/);
  assert.match(html, /pantalla apagada/);
  assert.doesNotMatch(html, /instalada en Windows|data-install-voice=/);
  assert.doesNotMatch(
    settingsMarkup({}, [], [], {}),
    /data-action="voice-settings"/,
  );
});
