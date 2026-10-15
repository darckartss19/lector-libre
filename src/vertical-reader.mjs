import { viewportAnchor } from "./core/reader-tools.mjs";

// Retain geometry for the whole book, but only keep five chapter/page surfaces mounted.
export function createVerticalReader(
  pane,
  {
    chapters,
    initialIndex = 0,
    locator = {},
    renderChapter,
    onChange,
    onError,
  },
) {
  let destroyed = false,
    frame = 0,
    navigating = false,
    currentIndex = initialIndex,
    navigationGeneration = 0,
    windowGeneration = 0;
  let lastPosition = null,
    lastWidth = pane.clientWidth,
    resizeTimer = 0;
  const active = new Map();
  pane.classList.add("vertical-reading-pane");
  const slots = chapters.map((chapter, index) => {
    const slot = document.createElement("section");
    slot.className = "vertical-slot";
    slot.dataset.verticalIndex = index;
    slot.style.height = `${Math.max(400, pane.clientHeight)}px`;
    slot.setAttribute("aria-label", chapter.title);
    return slot;
  });
  pane.replaceChildren(...slots);
  const release = (index) => {
    const item = active.get(index);
    if (!item) return;
    const height = Math.max(1, slots[index].getBoundingClientRect().height);
    active.delete(index);
    item.control?.destroy?.();
    observer.unobserve(slots[index]);
    slots[index].replaceChildren();
    slots[index].style.height = `${height}px`;
  };
  const focusedIndex = () => {
    if (
      pane.scrollTop > 0 &&
      pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
    )
      return slots.length - 1;
    const top = pane.scrollTop + 1;
    let low = 0,
      high = slots.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (slots[middle].offsetTop <= top) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const capture = () => {
    if (navigating) return null;
    if (resizeTimer || pane.clientWidth !== lastWidth) return lastPosition;
    const index = focusedIndex();
    if (!active.get(index)?.ready) return null;
    const slot = slots[index],
      prose = slot.querySelector(".prose");
    const height = Math.max(1, slot.getBoundingClientRect().height);
    const fraction = Math.min(
      1,
      Math.max(0, (pane.scrollTop - slot.offsetTop) / height),
    );
    const atEnd =
      index === slots.length - 1 &&
      pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    return {
      index,
      chapter: chapters[index].id,
      fraction: atEnd ? 1 : fraction,
      offset: prose ? (viewportAnchor(prose)?.start ?? 0) : undefined,
    };
  };
  const announce = () => {
    if (
      !destroyed &&
      !navigating &&
      !resizeTimer &&
      pane.clientWidth === lastWidth
    ) {
      const position = capture();
      if (position) {
        currentIndex = position.index;
        lastPosition = position;
        onChange?.(position);
      }
    }
  };
  async function mount(index) {
    if (active.has(index)) return active.get(index).job;
    const surface = document.createElement("div");
    surface.className = "vertical-surface";
    slots[index].append(surface);
    const item = { ready: false, control: null };
    active.set(index, item);
    item.job = (async () => {
      try {
        const control = await renderChapter(index, surface);
        if (destroyed || active.get(index) !== item) {
          control?.destroy?.();
          return;
        }
        item.control = control;
        const anchor = slots[currentIndex]?.getBoundingClientRect().top;
        slots[index].style.height = "auto";
        item.ready = true;
        observer.observe(slots[index]);
        if (index < currentIndex && anchor !== undefined)
          pane.scrollTop +=
            slots[currentIndex].getBoundingClientRect().top - anchor;
        announce();
      } catch (error) {
        if (!destroyed && active.get(index) === item) {
          const message = document.createElement("p");
          message.className = "quiet";
          message.textContent = "No se pudo preparar esta sección.";
          slots[index].replaceChildren(message);
          onError?.(error);
        }
      }
    })();
    return item.job;
  }
  async function ensureWindow(index) {
    const generation = ++windowGeneration;
    const first = Math.max(0, index - 2),
      last = Math.min(slots.length - 1, index + 2);
    for (const key of [...active.keys()])
      if (key < first || key > last) release(key);
    await mount(index);
    for (
      let neighbor = first;
      neighbor <= last && !destroyed && generation === windowGeneration;
      neighbor++
    )
      if (neighbor !== index) await mount(neighbor);
  }
  async function goTo(index, position = {}) {
    if (destroyed || !slots[index]) return;
    clearTimeout(resizeTimer);
    resizeTimer = 0;
    lastWidth = pane.clientWidth;
    const generation = ++navigationGeneration;
    navigating = true;
    currentIndex = index;
    lastPosition = {
      ...position,
      index,
      chapter: chapters[index].id,
      fraction: Math.max(0, Math.min(1, Number(position.fraction) || 0)),
    };
    // Place the viewport before loading, so geometry changes cannot move it to another chapter.
    pane.scrollTop = slots[index].offsetTop;
    await ensureWindow(index);
    if (destroyed || generation !== navigationGeneration) return;
    const slot = slots[index];
    pane.scrollTop =
      slot.offsetTop +
      Math.max(0, Math.min(1, Number(position.fraction) || 0)) *
        slot.getBoundingClientRect().height;
    const prose = slot.querySelector(".prose");
    if (prose && Number.isSafeInteger(position.offset) && position.offset > 0) {
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      let node,
        start = 0;
      while ((node = walker.nextNode())) {
        if (start + node.length > position.offset) {
          const range = document.createRange();
          range.setStart(node, position.offset - start);
          range.setEnd(
            node,
            Math.min(node.length, position.offset - start + 1),
          );
          pane.scrollTop +=
            range.getBoundingClientRect().top -
            pane.getBoundingClientRect().top;
          break;
        }
        start += node.length;
      }
    }
    navigating = false;
    announce();
  }
  const observer = new ResizeObserver(() => {
    if (destroyed) return;
    if (pane.clientWidth !== lastWidth) {
      lastWidth = pane.clientWidth;
      const position = lastPosition;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = 0;
        if (!destroyed && position)
          goTo(position.index, position).catch(onError);
      }, 150);
    } else announce();
  });
  observer.observe(pane);
  const onScroll = () => {
    if (
      frame ||
      destroyed ||
      navigating ||
      resizeTimer ||
      pane.clientWidth !== lastWidth
    )
      return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (navigating || resizeTimer || pane.clientWidth !== lastWidth) return;
      const index = focusedIndex();
      currentIndex = index;
      ensureWindow(index).then(announce).catch(onError);
      announce();
    });
  };
  pane.addEventListener("scroll", onScroll, { passive: true });
  const ready = goTo(initialIndex, locator);
  return {
    ready,
    capture,
    goTo,
    get activeCount() {
      return active.size;
    },
    restore(position) {
      const index = position.chapter
        ? chapters.findIndex((chapter) => chapter.id === position.chapter)
        : currentIndex;
      return goTo(Math.max(0, index), position);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      observer.disconnect();
      pane.removeEventListener("scroll", onScroll);
      for (const index of [...active.keys()]) release(index);
      pane.classList.remove("vertical-reading-pane");
    },
  };
}
