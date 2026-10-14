export const SPEECH_LANGUAGES = ["es", "en", "pt", "fr", "de", "it"];
export function languageName(code, ui = "es") {
  try {
    return new Intl.DisplayNames([ui], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
export function voicesForLanguage(voices, language = "auto") {
  return voices.filter(
    (voice) =>
      language === "auto" || voice.language?.split(/[-_]/)[0] === language,
  );
}
export function selectVoice(voices, preferences = {}, bookLanguage = "") {
  const installed = voices.filter((v) => v.installed !== false);
  const language =
    preferences.speechLanguage === "auto" || !preferences.speechLanguage
      ? bookLanguage || "es"
      : preferences.speechLanguage;
  const candidates = voicesForLanguage(installed, language.split(/[-_]/)[0]);
  const preferred = installed.find((voice) => voice.id === preferences.voice);
  if (preferred && candidates.includes(preferred)) return preferred;
  return (
    candidates.find((voice) => voice.engine === "piper") ??
    candidates[0] ??
    (preferences.speechLanguage && preferences.speechLanguage !== "auto"
      ? null
      : (preferred ?? installed[0] ?? null))
  );
}
