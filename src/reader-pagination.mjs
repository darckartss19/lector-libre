const readingModes = new Set(["scroll", "page", "spread"]);

export function normalizeReadingMode(mode) {
  return readingModes.has(mode) ? mode : "scroll";
}

const bounded = (value, low, high) => Math.min(high, Math.max(low, value));

/** Pure geometry shared by rendering and navigation; no text is copied. */
export function paginationGeometry({
  width,
  height,
  mode = "page",
  pageWidth = 760,
  padding = 28,
  gutter = 20,
} = {}) {
  const available = Math.max(1, Number(width) || 1);
  const gap = bounded(Number(gutter) || 0, 0, 80);
  const maximum = bounded(Number(pageWidth) || 760, 240, 1600);
  // Two columns require enough space to remain comfortable when a side panel opens.
  const columns = mode === "spread" && available >= 720 ? 2 : 1;
  const frameWidth = Math.min(
    available,
    columns * maximum + (columns - 1) * gap,
  );
  const physicalPageWidth = (frameWidth - (columns - 1) * gap) / columns;
  const frameHeight = Math.max(1, Number(height) || 1);
  const inset = bounded(
    Number(padding) || 0,
    0,
    Math.max(0, Math.min(physicalPageWidth / 4, (frameHeight - 1) / 2)),
  );
  const columnWidth = Math.max(1, physicalPageWidth - inset * 2);
  const columnGap = inset * 2 + gap;
  const columnStride = columnWidth + columnGap;
  return {
    columns,
    effectiveMode: columns === 2 ? "spread" : "page",
    frameWidth,
    frameHeight,
    padding: inset,
    physicalPageWidth,
    proseWidth: columns * columnWidth + (columns - 1) * columnGap,
    proseHeight: Math.max(1, frameHeight - inset * 2),
    columnWidth,
    columnGap,
    columnStride,
    viewStride: columns * columnStride,
  };
}

export function paginationPosition(pageCount, columns = 1, view = 0) {
  const count = Math.max(1, Math.ceil(Number(pageCount) || 1));
  const perView = columns === 2 ? 2 : 1;
  const viewCount = Math.ceil(count / perView);
  const viewIndex = bounded(Math.round(Number(view) || 0), 0, viewCount - 1);
  const page = viewIndex * perView + 1;
  return {
    page,
    pageEnd: Math.min(count, page + perView - 1),
    pageCount: count,
    visiblePages: perView,
    view: viewIndex,
    viewCount,
    atStart: viewIndex === 0,
    atEnd: viewIndex === viewCount - 1,
    fraction: viewCount === 1 ? 1 : viewIndex / (viewCount - 1),
  };
}

function textParts(prose) {
  const parts = [];
  const walker = prose.ownerDocument.createTreeWalker(prose, 4);
  let node,
    offset = 0;
  while ((node = walker.nextNode())) {
    parts.push({ node, start: offset, end: offset + node.data.length });
    offset += node.data.length;
  }
  return parts;
}

function rangeAt(prose, offset) {
  const parts = textParts(prose);
  const total = parts.at(-1)?.end ?? 0;
  if (!total) return null;
  const position = bounded(Math.trunc(Number(offset) || 0), 0, total - 1);
  const part = parts.find(({ end }) => end > position);
  const local = position - part.start;
  const range = prose.ownerDocument.createRange();
  range.setStart(part.node, local);
  range.setEnd(part.node, Math.min(part.node.length, local + 1));
  return range;
}

function firstVisibleOffset(prose, viewport, geometry) {
  const doc = prose.ownerDocument;
  const box = viewport.getBoundingClientRect();
  const article = prose.getBoundingClientRect();
  const range = doc.createRange();
  const intersects = (rect) =>
    rect.width >= 0 &&
    rect.height > 0 &&
    rect.right > box.left + 0.5 &&
    rect.left < box.right - 0.5 &&
    rect.bottom > box.top + 0.5 &&
    rect.top < box.bottom - 0.5;
  const targetColumn = geometry
    ? Math.round(viewport.scrollLeft / geometry.viewStride) * geometry.columns
    : 0;
  const beforeViewport = (rect) =>
    geometry
      ? Math.floor((rect.left - article.left + 0.5) / geometry.columnStride) <
        targetColumn
      : rect.bottom <= box.top + viewport.clientTop;
  for (const { node, start } of textParts(prose)) {
    if (!node.data.trim()) continue;
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some(intersects)) continue;
    // Column number is monotonic in DOM text order, unlike the vertical coordinate.
    let low = 0,
      high = node.length - 1;
    const charRect = (index) => {
      range.setStart(node, index);
      range.setEnd(node, Math.min(node.length, index + 1));
      return range.getBoundingClientRect();
    };
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (beforeViewport(charRect(middle))) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < node.length; index++) {
      if (/\s/u.test(node.data[index])) continue;
      const rect = charRect(index);
      if (intersects(rect)) {
        // Avoid persisting half of a surrogate pair as a Unicode anchor.
        if (index > 0 && /[\uDC00-\uDFFF]/u.test(node.data[index])) index--;
        return start + index;
      }
    }
  }
  return null;
}

/**
 * Paginate the existing .prose article. Import reader-pagination.css beside this
 * module. next/previous return false only at a chapter boundary; the application
 * owns changing chapters. A saved offset addresses UTF-16 textContent, matching
 * reader annotations, with fraction as fallback for old saved positions.
 */
export function createReaderPagination(
  pane,
  { mode = "scroll", locator, onChange = () => {} } = {},
) {
  const prose = pane?.querySelector(".prose");
  if (!prose?.ownerDocument)
    throw new TypeError("No hay un capítulo para paginar.");
  const doc = prose.ownerDocument;
  const win = doc.defaultView;
  let requestedMode = normalizeReadingMode(mode);
  let frame = null,
    stage = null,
    placeholder = null,
    geometry = null,
    pageCount = 1,
    viewIndex = 0,
    currentLocator = locator ?? { fraction: 0 },
    pendingFrame = 0,
    destroyed = false,
    changing = false,
    lastSignature = "",
    knownScrollTop = pane.scrollTop;
  const originalMode = pane.dataset.readingMode;

  const getFraction = () => {
    if (requestedMode !== "scroll")
      return paginationPosition(pageCount, geometry?.columns, viewIndex)
        .fraction;
    const distance = pane.scrollHeight - pane.clientHeight;
    return distance <= 0 ? 1 : bounded(pane.scrollTop / distance, 0, 1);
  };
  function visibleCapture() {
    const offset = firstVisibleOffset(prose, frame ?? pane, geometry);
    return { ...(offset === null ? {} : { offset }), fraction: getFraction() };
  }
  function capture() {
    syncScrolledPosition();
    // Retain the exact passage chosen before reflow, even if a new page starts
    // a few sentences earlier. Repeated resizes must not drift toward the start.
    return {
      ...(Number.isSafeInteger(currentLocator?.offset)
        ? { offset: currentLocator.offset }
        : visibleCapture()),
      fraction: getFraction(),
    };
  }
  function snapshot() {
    syncScrolledPosition();
    const position =
      requestedMode === "scroll"
        ? {
            page: 1,
            pageEnd: 1,
            pageCount: 1,
            visiblePages: 1,
            view: 0,
            viewCount: 1,
            atStart: pane.scrollTop <= 1,
            atEnd: pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1,
            fraction: getFraction(),
          }
        : paginationPosition(pageCount, geometry?.columns, viewIndex);
    return {
      mode: requestedMode,
      effectiveMode: geometry?.effectiveMode ?? "scroll",
      ...position,
      locator: capture(),
    };
  }
  function notify(force = false) {
    if (destroyed || changing) return;
    const state = snapshot();
    currentLocator = state.locator;
    const signature = JSON.stringify([
      state.mode,
      state.effectiveMode,
      state.page,
      state.pageCount,
      state.visiblePages,
      state.fraction,
      state.locator.offset,
    ]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    onChange(state);
  }
  function changeView(view) {
    const position = paginationPosition(pageCount, geometry.columns, view);
    viewIndex = position.view;
    frame.scrollLeft = viewIndex * geometry.viewStride;
    frame.scrollTop = 0;
  }
  function syncScrolledPosition() {
    if (changing || destroyed) return;
    if (frame) {
      const next = paginationPosition(
        pageCount,
        geometry.columns,
        frame.scrollLeft / geometry.viewStride,
      ).view;
      if (next !== viewIndex) {
        viewIndex = next;
        currentLocator = visibleCapture();
      }
    } else if (Math.abs(pane.scrollTop - knownScrollTop) > 0.5) {
      knownScrollTop = pane.scrollTop;
      currentLocator = visibleCapture();
    }
  }
  function onScroll() {
    syncScrolledPosition();
    notify();
  }
  function wrap() {
    placeholder = doc.createComment("reader pagination location");
    prose.before(placeholder);
    frame = doc.createElement("div");
    frame.className = "reader-page-frame";
    stage = doc.createElement("div");
    stage.className = "reader-page-stage";
    frame.append(stage);
    placeholder.after(frame);
    stage.append(prose);
    pane.classList.add("reader-paginated");
    frame.addEventListener("scroll", onScroll, { passive: true });
  }
  function unwrap() {
    if (!frame) return;
    frame.removeEventListener("scroll", onScroll);
    placeholder.replaceWith(prose);
    frame.remove();
    frame = stage = placeholder = geometry = null;
    pane.classList.remove("reader-paginated");
  }
  function layout() {
    if (requestedMode === "scroll") return;
    const css = win.getComputedStyle(pane);
    geometry = paginationGeometry({
      width: pane.clientWidth,
      height: pane.clientHeight,
      mode: requestedMode,
      pageWidth: parseFloat(css.getPropertyValue("--page-width")) || 760,
      padding: parseFloat(css.getPropertyValue("--page-padding")) || 28,
    });
    frame.style.width = `${geometry.frameWidth}px`;
    frame.style.height = `${geometry.frameHeight}px`;
    for (const [name, value] of [
      ["columns", geometry.columns],
      ["page-padding", geometry.padding],
      ["prose-width", geometry.proseWidth],
      ["prose-height", geometry.proseHeight],
      ["column-gap", geometry.columnGap],
      ["column-stride", geometry.columnStride],
      ["physical-page-width", geometry.physicalPageWidth],
    ])
      frame.style.setProperty(
        `--reader-${name}`,
        `${value}${name === "columns" ? "" : "px"}`,
      );
    const range = doc.createRange();
    range.selectNodeContents(prose);
    const articleLeft = prose.getBoundingClientRect().left;
    let rightmost = 0;
    for (const rect of range.getClientRects()) {
      if (rect.height > 0)
        rightmost = Math.max(rightmost, rect.right - articleLeft);
    }
    // Empty trailing columns of a spread are not counted as book pages.
    pageCount = Math.max(
      1,
      Math.floor(Math.max(0, rightmost - 0.5) / geometry.columnStride) + 1,
    );
    const views = Math.ceil(pageCount / geometry.columns);
    stage.style.width = `${(views - 1) * geometry.viewStride + geometry.frameWidth}px`;
    stage.style.height = `${geometry.frameHeight}px`;
    pane.scrollTop = 0;
    pane.scrollLeft = 0;
  }
  function restore(saved = {}) {
    if (destroyed) return false;
    changing = true;
    const hasOffset =
      Number.isSafeInteger(saved.offset) &&
      saved.offset >= 0 &&
      saved.offset <= (prose.textContent?.length ?? 0);
    const range = hasOffset ? rangeAt(prose, saved.offset) : null;
    const atChapterStart =
      saved.fraction === 0 &&
      hasOffset &&
      saved.offset <= Math.max(0, (prose.textContent ?? "").search(/\S/u));
    if (frame) {
      let view =
        bounded(Number(saved.fraction) || 0, 0, 1) *
        (Math.ceil(pageCount / geometry.columns) - 1);
      if (range) {
        const rect = range.getBoundingClientRect();
        const column = Math.max(
          0,
          Math.floor(
            (rect.left - prose.getBoundingClientRect().left + 0.5) /
              geometry.columnStride,
          ),
        );
        view = Math.floor(column / geometry.columns);
      }
      changeView(view);
    } else {
      const distance = Math.max(0, pane.scrollHeight - pane.clientHeight);
      pane.scrollTop = bounded(Number(saved.fraction) || 0, 0, 1) * distance;
      if (range && !atChapterStart) {
        const rect = range.getBoundingClientRect();
        pane.scrollTop +=
          rect.top - pane.getBoundingClientRect().top - pane.clientTop;
      }
    }
    knownScrollTop = pane.scrollTop;
    currentLocator =
      hasOffset && range
        ? { offset: saved.offset, fraction: getFraction() }
        : visibleCapture();
    changing = false;
    notify();
    return hasOffset;
  }
  function refresh(saved = currentLocator) {
    if (destroyed) return;
    changing = true;
    layout();
    changing = false;
    restore(saved);
    notify();
  }
  function queueRefresh() {
    if (pendingFrame || destroyed) return;
    pendingFrame = win.requestAnimationFrame(() => {
      pendingFrame = 0;
      refresh();
    });
  }
  function setMode(nextMode) {
    const next = normalizeReadingMode(nextMode);
    if (next === requestedMode) return snapshot();
    const saved = capture();
    changing = true;
    requestedMode = next;
    if (next === "scroll") unwrap();
    else if (!frame) wrap();
    pane.dataset.readingMode = next;
    changing = false;
    refresh(saved);
    return snapshot();
  }
  function step(direction) {
    if (destroyed || !frame) return false;
    const next = paginationPosition(
      pageCount,
      geometry.columns,
      viewIndex + direction,
    ).view;
    if (next === viewIndex) return false;
    changeView(next);
    currentLocator = visibleCapture();
    notify();
    return true;
  }
  function revealOffset(offset) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > (prose.textContent?.length ?? 0)
    )
      return false;
    return restore({ offset });
  }
  function reveal(anchor) {
    return revealOffset(anchor?.start ?? anchor?.offset);
  }
  function viewportAnchor() {
    const saved = visibleCapture();
    if (saved.offset === undefined) return null;
    return {
      start: saved.offset,
      end: saved.offset,
      quote: (prose.textContent ?? "")
        .slice(saved.offset, saved.offset + 120)
        .trimEnd(),
    };
  }
  pane.addEventListener("scroll", onScroll, { passive: true });
  pane.addEventListener("load", queueRefresh, true);
  const resizeObserver = new win.ResizeObserver(queueRefresh);
  resizeObserver.observe(pane);
  resizeObserver.observe(prose);
  // Marks only split the original nodes. A refresh keeps the same saved text offset.
  const mutationObserver = new win.MutationObserver(queueRefresh);
  mutationObserver.observe(prose, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const preferencesObserver = new win.MutationObserver(queueRefresh);
  preferencesObserver.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  const fonts = doc.fonts;
  fonts?.addEventListener("loadingdone", queueRefresh);
  fonts?.ready.then(() => {
    if (!destroyed) queueRefresh();
  });
  if (requestedMode !== "scroll") wrap();
  pane.dataset.readingMode = requestedMode;
  refresh(locator ?? { fraction: 0 });

  return {
    get mode() {
      return requestedMode;
    },
    get paginated() {
      return requestedMode !== "scroll";
    },
    snapshot,
    capture,
    viewportAnchor,
    restore,
    refresh,
    setMode,
    next: () => step(1),
    previous: () => step(-1),
    revealOffset,
    reveal,
    destroy() {
      if (destroyed) return;
      const saved = capture();
      destroyed = true;
      win.cancelAnimationFrame(pendingFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      preferencesObserver.disconnect();
      fonts?.removeEventListener("loadingdone", queueRefresh);
      pane.removeEventListener("scroll", onScroll);
      pane.removeEventListener("load", queueRefresh, true);
      unwrap();
      if (originalMode === undefined) delete pane.dataset.readingMode;
      else pane.dataset.readingMode = originalMode;
      // A surviving reader remains at the same passage after removing the controller.
      const range = rangeAt(prose, saved.offset);
      const atChapterStart =
        saved.fraction === 0 &&
        saved.offset <= Math.max(0, (prose.textContent ?? "").search(/\S/u));
      if (range && !atChapterStart)
        pane.scrollTop +=
          range.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          pane.clientTop;
    },
  };
}
