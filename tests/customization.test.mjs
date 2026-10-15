import test from "node:test";
import assert from "node:assert/strict";
import { THEMES } from "../src/core/appearance.mjs";
import { contrastRatio } from "../src/core/spines.mjs";
import { createLibrary, addBook, importLibrary } from "../src/core/library.mjs";
import { stampChanges, mergeSnapshots } from "../src/core/sync.mjs";
import { CloudSnapshot } from "../src/core/cloud-snapshot.mjs";
import {
  selectVoice,
  voicesForLanguage,
} from "../src/core/voice-selection.mjs";
import { translate } from "../src/core/i18n.mjs";
import { SyncSchedule } from "../src/core/sync-schedule.mjs";
test("All palettes preserve text contrast on backgrounds and panels", () => {
  assert.equal(THEMES.filter((t) => t.dark).length, 7);
  for (const theme of THEMES) {
    for (const bg of theme.colors.slice(0, 3)) {
      assert.ok(contrastRatio(theme.colors[3], bg) >= 4.5, theme.id + " text");
      assert.ok(
        contrastRatio(theme.colors[4], bg) >= 4.5,
        theme.id + " secondary text",
      );
    }
  }
});
test("Theme accents remain readable on selected controls and primary buttons", () => {
  for (const theme of THEMES) {
    const accent = theme.colors[6];
    const buttonInk = theme.dark ? "#101512" : "#ffffff";
    for (const background of [...theme.colors.slice(0, 3), theme.colors[7]]) {
      assert.ok(contrastRatio(accent, background) >= 4.5, `${theme.id} accent`);
    }
    assert.ok(contrastRatio(buttonInk, accent) >= 4.5, `${theme.id} primary`);
  }
});
test("Reading pages have their own restrained background and high contrast text", () => {
  for (const theme of THEMES) {
    const [background, ink] = theme.page;
    assert.ok(contrastRatio(ink, background) >= 7, `${theme.id} reading text`);
    assert.ok(
      contrastRatio(theme.colors[6], background) >= 4.5,
      `${theme.id} page link`,
    );
    assert.ok(
      contrastRatio(ink, theme.colors[7]) >= 4.5,
      `${theme.id} selection`,
    );
    assert.notEqual(background, theme.colors[1], `${theme.id} page and panel`);
  }
});
test("Page, UI language and speech choices survive a new device merge; invalid values are rejected", () => {
  const p = {
    theme: "midnight",
    pageTheme: "ember",
    font: "wide",
    fontSize: 34,
    lineHeight: 2.2,
    pageWidth: 1000,
    pagePadding: 48,
    paragraphSpacing: 1.5,
    letterSpacing: 0.04,
    textAlign: "justify",
    firstLineIndent: true,
    uiLanguage: "en",
    speechLanguage: "fr",
    voice: "piper:fr",
    rate: 0.9,
  };
  const snapshot = stampChanges(
    createLibrary(),
    { ...createLibrary(), preferences: { view: "covers", ...p } },
    "first",
    1,
  );
  assert.deepEqual(
    mergeSnapshots({ ...createLibrary(), deviceId: "second" }, [snapshot])
      .preferences,
    { view: "covers", ...p },
  );
  for (const [key, value] of Object.entries({
    pageWidth: 300000,
    pagePadding: -1,
    letterSpacing: NaN,
    uiLanguage: "bad",
    firstLineIndent: "yes",
    textAlign: "bad",
  }))
    assert.throws(() =>
      importLibrary(
        JSON.stringify({ ...createLibrary(), preferences: { [key]: value } }),
      ),
    );
});
test("Voice language takes priority over an incompatible stored voice and missing downloads", () => {
  const voices = [
    { id: "windows", language: "es-MX" },
    { id: "natural", language: "es-ES", engine: "piper", installed: true },
    { id: "english", language: "en-US" },
    { id: "pending", language: "fr-FR", engine: "piper", installed: false },
  ];
  assert.equal(
    selectVoice(voices, { voice: "english", speechLanguage: "es" }).id,
    "natural",
  );
  assert.equal(
    selectVoice(voices, { speechLanguage: "auto" }, "en-US").id,
    "english",
  );
  assert.equal(selectVoice(voices, { speechLanguage: "fr" }), null);
  assert.equal(voicesForLanguage(voices, "es").length, 2);
  assert.equal(
    translate("Personalización de páginas", "en"),
    "Page customization",
  );
});
test("Wire cover previews are cached without changing local images, revisions or progress", async () => {
  const original = "original cover " + "x".repeat(100000);
  const base = stampChanges(
    createLibrary(),
    addBook(
      createLibrary(),
      { id: "book", title: "Tu lectura", format: "epub", cover: original },
      1,
    ),
    "first",
    1,
  );
  let count = 0;
  const encoder = new CloudSnapshot(async () => {
    count++;
    return "small preview";
  });
  const wire = await encoder.create(base);
  assert.equal(wire.books[0].cover, "small preview");
  assert.equal(
    wire.registers[JSON.stringify(["book", "cover"])].value,
    "small preview",
  );
  assert.equal(base.books[0].cover, original);
  assert.equal(
    base.registers[JSON.stringify(["book", "cover"])].value,
    original,
  );
  assert.equal(mergeSnapshots(base, [wire]), base);
  await encoder.create(base);
  assert.equal(count, 1);
  const other = stampChanges(
    wire,
    { ...wire, preferences: { view: "covers", uiLanguage: "en" } },
    "second",
    2,
  );
  assert.equal(mergeSnapshots(base, [other]).books[0].cover, original);
  const newDevice = mergeSnapshots({ ...createLibrary(), deviceId: "third" }, [
    wire,
  ]);
  assert.equal(newDevice.books[0].cover, "small preview");
  assert.ok(JSON.stringify(wire).length < JSON.stringify(base).length / 20);
});
test("Repeated background sync failures back off and notify once, then reset on success", () => {
  const schedule = new SyncSchedule();
  assert.equal(schedule.failed(0), true);
  assert.equal(schedule.ready(60000), false);
  assert.equal(schedule.failed(120000), false);
  assert.equal(schedule.nextAttempt, 360000);
  for (let i = 0; i < 10; i++) schedule.failed(0);
  assert.equal(schedule.nextAttempt, 900000);
  schedule.success(0);
  assert.equal(schedule.ready(0), false);
  assert.equal(schedule.ready(300000), true);
  assert.equal(schedule.failed(0), true);
});
