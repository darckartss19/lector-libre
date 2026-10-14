import { selectionAnchor } from "./core/reader-tools.mjs";

const highlightName = "lector-speech";
const painted = new WeakMap();
const maps = new WeakMap();

function safeBoundary(text, offset) {
  return offset > 0 &&
    /[\uDC00-\uDFFF]/u.test(text[offset]) &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1])
    ? offset - 1
    : offset;
}

// EPUB speech text adds separators after blocks; DOM anchors deliberately do not.
// Match every non-whitespace UTF-16 unit in order instead of using quote search,
// which could select the wrong occurrence of a repeated sentence.
function textMap(prose, chapter) {
  if (!prose?.ownerDocument || typeof chapter?.text !== "string") return null;
  const dom = prose.textContent ?? "",
    speech = chapter.text;
  const cached = maps.get(prose);
  if (cached?.dom === dom && cached.speech === speech) return cached;
  // Two packed indices per code unit avoid an object allocation for every letter
  // in long TXT chapters. The weak cache is released with the reader article.
  const positions = new Uint32Array(Math.min(dom.length, speech.length) * 2);
  let domOffset = 0,
    speechOffset = 0,
    count = 0;
  while (domOffset < dom.length || speechOffset < speech.length) {
    while (domOffset < dom.length && /\s/u.test(dom[domOffset])) domOffset++;
    while (speechOffset < speech.length && /\s/u.test(speech[speechOffset]))
      speechOffset++;
    if (domOffset === dom.length && speechOffset === speech.length) break;
    if (dom[domOffset] !== speech[speechOffset]) return null;
    positions[count * 2] = domOffset++;
    positions[count * 2 + 1] = speechOffset++;
    count++;
  }
  const result = { dom, speech, positions, count };
  maps.set(prose, result);
  return result;
}

function lowerBound(map, key, offset) {
  let left = 0,
    right = map.count;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (map.positions[middle * 2 + key] < offset) left = middle + 1;
    else right = middle;
  }
  return left;
}

/** Translate an annotation/selection anchor to the speech chapter's UTF-16 space. */
export function speechPositionForAnchor(prose, chapter, anchor) {
  const map = textMap(prose, chapter);
  if (
    !map ||
    !Number.isSafeInteger(anchor?.start) ||
    anchor.start < 0 ||
    anchor.start > map.dom.length ||
    (anchor.end !== undefined &&
      (!Number.isSafeInteger(anchor.end) ||
        anchor.end < anchor.start ||
        anchor.end > map.dom.length)) ||
    (typeof anchor.quote === "string" &&
      anchor.end !== undefined &&
      anchor.end > anchor.start &&
      map.dom.slice(anchor.start, anchor.end) !== anchor.quote)
  )
    return null;
  const start = safeBoundary(map.dom, anchor.start);
  const pair = lowerBound(map, 0, start);
  return {
    chapter: chapter.id,
    offset: pair < map.count ? map.positions[pair * 2 + 1] : map.speech.length,
  };
}

export function speechPositionFromSelection(prose, chapter) {
  return speechPositionForAnchor(prose, chapter, selectionAnchor(prose));
}

/** A paragraph click starts at that paragraph, including its inline formatting. */
export function speechPositionForParagraph(prose, chapter, target) {
  if (!prose?.ownerDocument || !target || !prose.contains(target)) return null;
  const element = target.nodeType === 1 ? target : target.parentElement;
  const paragraph = element?.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre");
  if (!paragraph || !prose.contains(paragraph)) return null;
  const prefix = prose.ownerDocument.createRange();
  prefix.selectNodeContents(prose);
  prefix.setEnd(paragraph, 0);
  return speechPositionForAnchor(prose, chapter, {
    start: prefix.toString().length,
  });
}

function domRange(prose, start, end) {
  const doc = prose.ownerDocument;
  const walker = doc.createTreeWalker(prose, 4);
  const range = doc.createRange();
  let node,
    offset = 0,
    started = false;
  while ((node = walker.nextNode())) {
    const next = offset + node.data.length;
    if (!started && next > start) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && next >= end) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}

export function clearSpeechHighlight(prose) {
  if (!prose?.ownerDocument) return;
  const previous = painted.get(prose);
  const registry = prose.ownerDocument.defaultView?.CSS?.highlights;
  if (
    previous?.highlight &&
    registry?.get(highlightName) === previous.highlight
  )
    registry.delete(highlightName);
  for (const mark of prose.querySelectorAll("mark[data-reader-speech]"))
    mark.replaceWith(...mark.childNodes);
  if (previous?.mode === "marks") prose.normalize();
  painted.delete(prose);
}

function markRange(prose, start, end) {
  const doc = prose.ownerDocument;
  const walker = doc.createTreeWalker(prose, 4);
  const nodes = [];
  let node,
    offset = 0;
  while ((node = walker.nextNode())) {
    const next = offset + node.data.length;
    if (next > start && offset < end)
      nodes.push({
        node,
        start: Math.max(0, start - offset),
        end: Math.min(node.data.length, end - offset),
      });
    offset = next;
  }
  let first = null;
  for (const part of nodes) {
    const fragment = doc.createDocumentFragment();
    if (part.start)
      fragment.append(doc.createTextNode(part.node.data.slice(0, part.start)));
    const mark = doc.createElement("mark");
    mark.dataset.readerSpeech = "true";
    mark.className = "reader-speech-fragment";
    mark.textContent = part.node.data.slice(part.start, part.end);
    fragment.append(mark);
    if (part.end < part.node.data.length)
      fragment.append(doc.createTextNode(part.node.data.slice(part.end)));
    part.node.replaceWith(fragment);
    first ??= mark;
  }
  return first;
}

/** Highlight the submitted fragment, not an estimated current word for Piper. */
export function highlightSpeechFragment(
  prose,
  chapter,
  request,
  { scroll = false, useHighlights = true } = {},
) {
  clearSpeechHighlight(prose);
  if (
    request?.chapter !== chapter?.id ||
    !Number.isSafeInteger(request?.start) ||
    !Number.isSafeInteger(request?.end) ||
    request.start < 0 ||
    request.end <= request.start ||
    request.end > (chapter?.text?.length ?? 0) ||
    (typeof request.text === "string" &&
      chapter.text.slice(request.start, request.end) !== request.text)
  )
    return null;
  const map = textMap(prose, chapter);
  if (!map) return null;
  const first = lowerBound(map, 1, request.start),
    last = lowerBound(map, 1, request.end) - 1;
  if (last < first || first >= map.count) return null;
  const start = safeBoundary(map.dom, map.positions[first * 2]),
    end = map.positions[last * 2] + 1;
  const range = domRange(prose, start, end);
  if (!range) return null;
  const view = prose.ownerDocument.defaultView;
  let mode,
    mark = null;
  if (useHighlights && view?.CSS?.highlights && view.Highlight) {
    const highlight = new view.Highlight(range);
    view.CSS.highlights.set(highlightName, highlight);
    painted.set(prose, { mode: "highlight", highlight });
    mode = "highlight";
  } else {
    mark = markRange(prose, start, end);
    painted.set(prose, { mode: "marks" });
    mode = "marks";
  }
  if (scroll) {
    const target = mark ?? range.startContainer.parentElement;
    target?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "auto",
    });
  }
  return { start, end, mode };
}
