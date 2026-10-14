export function nativeAudioQueue(state) {
  if (!state.hasProgram || !state.bookId || !state.chapter) return null;
  return {
    bookId: state.bookId,
    voice: state.voice,
    rate: state.rate,
    chapters: [{ id: state.chapter }],
    index: 0,
    active: state.active,
    checkpoint: () => ({
      chapter: state.chapter,
      offset: state.offset,
      voice: state.voice,
      rate: state.rate,
    }),
  };
}
