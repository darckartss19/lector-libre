import { runtimePolicy } from "./core/runtime-policy.mjs";

export function createPdfReader(
  pane,
  {
    document: pdf,
    textLayerFactory,
    pageNumber,
    zoom = "fit-page",
    rotation = 0,
    layout = "page",
    borderless = false,
    onChange,
    onError,
    pageLabel = (number) => `Página ${number}`,
  },
) {
  const policy = runtimePolicy({
    mobile: document.documentElement.dataset.platform === "android",
    deviceMemory: navigator.deviceMemory,
  });
  let destroyed = false,
    generation = 0,
    pending = 0,
    visiblePages = 1,
    rendering = false;
  let savedFraction = 0;
  const tasks = new Set();
  let lastSize = `${pane.clientWidth}:${pane.clientHeight}`;
  const release = (surface) => {
    for (const canvas of surface.querySelectorAll("canvas"))
      canvas.width = canvas.height = 0;
  };
  const fraction = () => {
    const distance = pane.scrollHeight - pane.clientHeight;
    return distance <= 0
      ? 1
      : Math.max(0, Math.min(1, pane.scrollTop / distance));
  };
  const restore = (locator = {}) => {
    savedFraction = Math.max(0, Math.min(1, Number(locator.fraction) || 0));
    pane.scrollTop =
      savedFraction * Math.max(0, pane.scrollHeight - pane.clientHeight);
    onChange?.();
  };
  async function render() {
    const run = ++generation;
    rendering = true;
    for (const task of tasks) task.cancel();
    tasks.clear();
    const nextPages =
      layout === "spread" &&
      pane.clientWidth >= 720 &&
      pageNumber < pdf.numPages
        ? 2
        : 1;
    visiblePages = nextPages;
    let installed = false;
    const surface = document.createElement("div");
    surface.className = "pdf-pages";
    try {
      for (let index = 0; index < nextPages; index++) {
        const page = await pdf.getPage(pageNumber + index);
        if (destroyed || run !== generation) return;
        const base = page.getViewport({
          scale: 1,
          rotation: page.rotate + rotation,
        });
        const width = Math.max(
          80,
          (pane.clientWidth - (borderless ? 0 : 32) - (nextPages - 1) * 20) /
            nextPages,
        );
        const height = Math.max(80, pane.clientHeight - 24);
        const scale =
          zoom === "fit-width"
            ? width / base.width
            : zoom === "fit-page"
              ? Math.min(width / base.width, height / base.height)
              : Number(zoom);
        const viewport = page.getViewport({
          scale,
          rotation: page.rotate + rotation,
        });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(policy.pdfPixels / (viewport.width * viewport.height)),
        );
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
        wrapper.style.setProperty("--total-scale-factor", viewport.scale);
        wrapper.style.setProperty("--scale-round-x", "1px");
        wrapper.style.setProperty("--scale-round-y", "1px");
        surface.append(wrapper);
        const canvas = document.createElement("canvas");
        wrapper.append(canvas);
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", pageLabel(pageNumber + index));
        const task = page.render({
          canvas,
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform:
            outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
          background: "rgb(255,255,255)",
        });
        tasks.add(task);
        await task.promise;
        tasks.delete(task);
        if (destroyed || run !== generation) return;
        if (textLayerFactory) {
          const container = document.createElement("div");
          container.className = "textLayer";
          wrapper.append(container);
          const layer = textLayerFactory(page, container, viewport);
          tasks.add(layer);
          await layer.render();
          tasks.delete(layer);
          if (destroyed || run !== generation) return;
        }
      }
      release(pane);
      pane.replaceChildren(surface);
      installed = true;
      rendering = false;
      restore({ fraction: savedFraction });
    } catch (error) {
      if (
        !destroyed &&
        run === generation &&
        error.name !== "RenderingCancelledException"
      ) {
        rendering = false;
        onError?.(error);
      }
    } finally {
      if (!installed) release(surface);
    }
  }
  const refresh = () => {
    if (pending || destroyed) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (destroyed) return;
      render();
    });
  };
  const onScroll = () => {
    if (!rendering) savedFraction = fraction();
    onChange?.();
  };
  pane.addEventListener("scroll", onScroll, { passive: true });
  const resize = new ResizeObserver(() => {
    const size = `${pane.clientWidth}:${pane.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    refresh();
  });
  resize.observe(pane);
  const ready = render();
  return {
    ready,
    capture: () => ({ fraction: rendering ? savedFraction : fraction() }),
    get visiblePages() {
      return visiblePages;
    },
    restore,
    refresh,
    destroy() {
      destroyed = true;
      generation++;
      resize.disconnect();
      cancelAnimationFrame(pending);
      pane.removeEventListener("scroll", onScroll);
      for (const task of tasks) task.cancel();
      tasks.clear();
      for (const canvas of pane.querySelectorAll("canvas"))
        canvas.width = canvas.height = 0;
    },
  };
}

export function selectedPdfQuote(surface) {
  const selection = window.getSelection();
  if (
    !surface ||
    !selection?.rangeCount ||
    selection.isCollapsed ||
    !surface.contains(selection.anchorNode) ||
    !surface.contains(selection.focusNode)
  )
    return "";
  const inside = (node) =>
    (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(
      ".textLayer",
    );
  if (!inside(selection.anchorNode) || !inside(selection.focusNode)) return "";
  return selection.toString().trim();
}
