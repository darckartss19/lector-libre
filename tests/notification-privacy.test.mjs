import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Android system media and notification surfaces cannot reuse the reading title", () => {
  const source = readFileSync(
    new URL(
      "../native/mobile/android/src/main/java/ReaderSpeechService.kt",
      import.meta.url,
    ),
    "utf8",
  );
  const media = source.slice(
    source.indexOf("private fun updateMedia()"),
    source.indexOf("private fun foreground()"),
  );
  const notification = source.slice(
    source.indexOf("private fun notification()"),
    source.indexOf("private fun persist("),
  );
  assert.match(source, /const val GENERIC_TITLE = "Lectura en voz alta"/);
  assert.match(media, /METADATA_KEY_TITLE, GENERIC_TITLE/);
  assert.doesNotMatch(media, /program\?\.let|\.title/);
  assert.match(notification, /setContentTitle\(GENERIC_TITLE\)/);
  assert.match(notification, /VISIBILITY_PRIVATE/);
  assert.doesNotMatch(notification, /\.title|VISIBILITY_PUBLIC/);
  assert.ok(
    /put\("title", p\.title\)/.test(source),
    "The internal reading identity remains available for restoration.",
  );
});
