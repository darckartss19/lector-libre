// Reader anchors use UTF-16 offsets in the displayed chapter's textContent.
// Speech text may add paragraph separators, so it is never used as an HTML anchor.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const annotationColors = new Set(["yellow", "green", "blue", "pink"]);
const searchTimers = new WeakMap();

function foldedText(text) {
  let value = "",
    lastWasSpace = false;
  const starts = [],
    ends = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const folded = segment
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .toLocaleLowerCase("es");
    for (const character of folded) {
      if (/\s/u.test(character)) {
        if (lastWasSpace) {
          ends[ends.length - 1] = index + segment.length;
          continue;
        }
        value += " ";
        lastWasSpace = true;
        starts.push(index);
        ends.push(index + segment.length);
      } else {
        value += character;
        lastWasSpace = false;
        // indexOf and DOM anchors both count UTF-16 code units.
        for (let unit = 0; unit < character.length; unit++) {
          starts.push(index);
          ends.push(index + segment.length);
        }
      }
    }
  }
  return { value, starts, ends };
}

function chapterText(chapter) {
  if (typeof chapter.html === "string") {
    if (typeof DOMParser === "undefined")
      throw new Error("Los capítulos HTML requieren el lector del navegador.");
    // An inert element has exactly the same text offsets as the reader article.
    const doc = new DOMParser().parseFromString("", "text/html");
    const prose = doc.createElement("article");
    prose.innerHTML = chapter.html;
    return prose.textContent ?? "";
  }
  return String(chapter.text ?? "");
}

/** Search sanitized chapter HTML without changing it or its original offsets. */
export function searchBook(chapters, query, { limit = 100 } = {}) {
  const needle = foldedText(String(query ?? "").trim()).value.trim();
  if (!needle || !Array.isArray(chapters)) return [];
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
  if (!maximum) return [];
  const results = [];
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex];
    const original = chapterText(chapter);
    const folded = foldedText(original);
    let cursor = 0,
      previousStart = -1,
      previousEnd = -1;
    for (;;) {
      const match = folded.value.indexOf(needle, cursor);
      if (match < 0) break;
      cursor = match + needle.length;
      const start = folded.starts[match];
      const end = folded.ends[cursor - 1];
      // A compatibility ligature can yield several folded matches in one glyph.
      if (start === previousStart && end === previousEnd) continue;
      previousStart = start;
      previousEnd = end;
      results.push({
        chapter: chapter.id,
        chapterIndex,
        start,
        end,
        quote: original.slice(start, end),
        context:
          (start > 65 ? "…" : "") +
          original.slice(
            Math.max(0, start - 65),
            Math.min(original.length, end + 65),
          ) +
          (end + 65 < original.length ? "…" : ""),
      });
      if (results.length >= maximum) return results;
    }
  }
  return results;
}

/** Return an anchor only when the entire selection belongs to this chapter. */
export function selectionAnchor(proseElement) {
  if (!proseElement?.ownerDocument) return null;
  const selection = proseElement.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !proseElement.contains(range.startContainer) ||
    !proseElement.contains(range.endContainer)
  )
    return null;
  const prefix = proseElement.ownerDocument.createRange();
  prefix.selectNodeContents(proseElement);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const end = start + range.toString().length;
  const quote = (proseElement.textContent ?? "").slice(start, end);
  if (!quote || end <= start) return null;
  return { start, end, quote };
}

/** Anchor a bookmark to the first text visible in the scrolling reading pane. */
export function viewportAnchor(proseElement) {
  if (!proseElement?.ownerDocument) return null;
  const doc = proseElement.ownerDocument;
  const view = doc.defaultView;
  const pane =
    proseElement.closest(".reading-pane") ?? proseElement.parentElement;
  if (!view || !pane) return null;
  const box = pane.getBoundingClientRect();
  const visible = {
    top: Math.max(0, box.top + pane.clientTop),
    bottom: Math.min(view.innerHeight, box.bottom),
    left: Math.max(0, box.left + pane.clientLeft),
    right: Math.min(view.innerWidth, box.right),
  };
  if (visible.bottom <= visible.top || visible.right <= visible.left)
    return null;
  const intersects = (rect) =>
    rect.height > 0 &&
    rect.bottom > visible.top &&
    rect.top < visible.bottom &&
    rect.right > visible.left &&
    rect.left < visible.right;
  const walker = doc.createTreeWalker(proseElement, 4);
  const range = doc.createRange();
  let node,
    offset = 0;
  while ((node = walker.nextNode())) {
    const text = node.data;
    range.selectNodeContents(node);
    if (!text.trim() || ![...range.getClientRects()].some(intersects)) {
      offset += text.length;
      continue;
    }
    const boundaries = [...segmenter.segment(text)].map(({ index }) => index);
    boundaries.push(text.length);
    const rectAt = (index) => {
      range.setStart(node, boundaries[index]);
      range.setEnd(node, boundaries[index + 1]);
      return range.getBoundingClientRect();
    };
    // Text wraps monotonically down the page. Binary search avoids measuring
    // thousands of characters in long paragraphs when the viewport is near its end.
    let low = 0,
      high = boundaries.length - 2;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rectAt(middle).bottom > visible.top) high = middle;
      else low = middle + 1;
    }
    for (let index = low; index < boundaries.length - 1; index++) {
      if (/^\s+$/u.test(text.slice(boundaries[index], boundaries[index + 1])))
        continue;
      const rect = rectAt(index);
      if (rect.top >= visible.bottom) break;
      if (!intersects(rect)) continue;
      const start = offset + boundaries[index];
      return {
        start,
        end: start,
        // Bookmarks use a zero-length anchor plus readable context, not a quote range.
        quote: (proseElement.textContent ?? "")
          .slice(start, start + 120)
          .trimEnd(),
      };
    }
    offset += text.length;
  }
  return null;
}

function validAnchor(anchor, text) {
  return (
    Number.isInteger(anchor?.start) &&
    Number.isInteger(anchor?.end) &&
    anchor.start >= 0 &&
    anchor.end > anchor.start &&
    anchor.end <= text.length &&
    (typeof anchor.quote !== "string" ||
      text.slice(anchor.start, anchor.end) === anchor.quote)
  );
}

function unwrapMarks(proseElement, selector) {
  for (const mark of proseElement.querySelectorAll(selector))
    mark.replaceWith(...mark.childNodes);
  // Avoid accumulating fragmented nodes after repeated highlighting/removal.
  proseElement.normalize();
}

/** Remove only marks owned by the reader; keep any markup in the original book. */
export function clearAnnotations(proseElement) {
  if (proseElement?.querySelectorAll)
    unwrapMarks(proseElement, "mark[data-reader-annotation]");
}

function paintRanges(proseElement, ranges, createMark) {
  const doc = proseElement.ownerDocument;
  const walker = doc.createTreeWalker(proseElement, 4); // SHOW_TEXT
  const nodes = [];
  let node,
    offset = 0;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: offset, end: offset + node.data.length });
    offset += node.data.length;
  }
  let firstMark = null;
  for (const part of nodes) {
    const local = ranges.filter(
      (range) => range.start < part.end && range.end > part.start,
    );
    if (!local.length) continue;
    const boundaries = new Set([0, part.node.data.length]);
    for (const range of local) {
      boundaries.add(Math.max(0, range.start - part.start));
      boundaries.add(Math.min(part.node.data.length, range.end - part.start));
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    const fragment = doc.createDocumentFragment();
    for (let index = 1; index < ordered.length; index++) {
      const start = ordered[index - 1],
        end = ordered[index];
      if (end <= start) continue;
      let child = doc.createTextNode(part.node.data.slice(start, end));
      for (const range of local.filter(
        (range) =>
          range.start < part.start + end && range.end > part.start + start,
      )) {
        const mark = createMark(range, doc);
        mark.append(child);
        child = mark;
        firstMark ??= mark;
      }
      fragment.append(child);
    }
    part.node.replaceWith(fragment);
  }
  return firstMark;
}

/** Paint highlights and notes across text nodes, preserving links and images. */
export function annotateChapter(proseElement, annotations = []) {
  if (!proseElement?.ownerDocument) return 0;
  clearAnnotations(proseElement);
  const text = proseElement.textContent ?? "";
  const seen = new Set();
  const ranges = annotations.filter((annotation) => {
    if (
      !annotation ||
      typeof annotation.id !== "string" ||
      !annotation.id ||
      seen.has(annotation.id) ||
      annotation.deleted ||
      annotation.deletedAt ||
      !["highlight", "note"].includes(annotation.type) ||
      !validAnchor(annotation, text)
    )
      return false;
    seen.add(annotation.id);
    return true;
  });
  paintRanges(proseElement, ranges, (annotation, doc) => {
    const mark = doc.createElement("mark");
    mark.className = "reader-annotation reader-highlight";
    mark.dataset.readerAnnotation = "true";
    mark.dataset.annotation = annotation.id;
    mark.dataset.annotationType = annotation.type;
    mark.dataset.color = annotationColors.has(annotation.color)
      ? annotation.color
      : "yellow";
    return mark;
  });
  return ranges.length;
}

function clearSearchHits(proseElement) {
  clearTimeout(searchTimers.get(proseElement));
  searchTimers.delete(proseElement);
  unwrapMarks(proseElement, "mark[data-reader-search-hit]");
}

/** Reveal a result without removing saved annotations, then clear its glow. */
export function revealAnchor(proseElement, anchor) {
  if (!proseElement?.ownerDocument) return null;
  clearSearchHits(proseElement);
  const text = proseElement.textContent ?? "";
  let target = anchor;
  if (
    Number.isInteger(anchor?.start) &&
    anchor.start === anchor.end &&
    anchor.start >= 0 &&
    anchor.start < text.length
  ) {
    const snippet =
      typeof anchor.quote === "string" && anchor.quote
        ? anchor.quote
        : ([...segmenter.segment(text.slice(anchor.start))][0]?.segment ?? "");
    target = { ...anchor, end: anchor.start + snippet.length, quote: snippet };
  }
  if (!validAnchor(target, text)) return null;
  const first = paintRanges(proseElement, [target], (_, doc) => {
    const mark = doc.createElement("mark");
    mark.className = "reader-search-hit";
    mark.dataset.searchHit = "true";
    mark.dataset.readerSearchHit = "true";
    return mark;
  });
  first?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "auto",
  });
  if (first)
    searchTimers.set(
      proseElement,
      setTimeout(() => clearSearchHits(proseElement), 2500),
    );
  return first;
}
