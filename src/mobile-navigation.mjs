import { icon } from "./icons.mjs";

export function mobileNavigation(
  root,
  { localize = () => {}, speech = true } = {},
) {
  const narrow = matchMedia(
    "(max-width: 700px), (max-width: 1100px) and (pointer: coarse)",
  );
  let restoreFocus = null;
  function setOpen(open) {
    const visible = open && narrow.matches;
    root.classList.toggle("mobile-menu-open", visible);
    const sidebar = root.querySelector(".sidebar");
    if (sidebar) sidebar.inert = narrow.matches && !visible;
    const workspace = root.querySelector(".workspace");
    if (workspace) workspace.inert = visible;
    root
      .querySelector("[data-mobile-menu]")
      ?.setAttribute("aria-expanded", String(visible));
    if (visible) {
      restoreFocus = document.activeElement;
      sidebar?.querySelector("button")?.focus();
    } else {
      restoreFocus?.isConnected && restoreFocus.focus();
      restoreFocus = null;
    }
  }
  function decorate() {
    if (!root.querySelector(".mobile-header")) {
      root.insertAdjacentHTML(
        "afterbegin",
        `<header class="mobile-header"><button data-mobile-menu aria-expanded="false" aria-controls="library-sidebar" aria-label="Abrir menú">${icon("list")}</button><span>Lector libre</span><button data-action="import" aria-label="Añadir libros">${icon("plus")}</button></header><button class="mobile-menu-backdrop" data-mobile-close tabindex="-1" aria-label="Cerrar menú"></button>`,
      );
    }
    const sidebar = root.querySelector(".sidebar");
    if (sidebar) sidebar.id = "library-sidebar";
    const tools = root.querySelector(".reader-tools");
    if (tools && !root.querySelector("[data-mobile-tools]")) {
      root.classList.remove("mobile-tools-open");
      tools.id = "reading-tools";
      tools.insertAdjacentHTML(
        "beforebegin",
        `<button class="mobile-tools-toggle" data-mobile-tools aria-expanded="false" aria-controls="reading-tools">${icon("settings")} Herramientas de lectura</button>`,
      );
    }
    if (!speech)
      root
        .querySelectorAll(
          '[data-action="start-audio"],[data-action="audio-from-here"]',
        )
        .forEach((button) => {
          button.hidden = true;
        });
    root.classList.toggle(
      "mobile-reading",
      !!root.querySelector(".reading-workspace"),
    );
    localize(root);
    setOpen(false);
  }
  function handle(button) {
    if (button.hasAttribute("data-mobile-menu")) {
      setOpen(!root.classList.contains("mobile-menu-open"));
      return true;
    }
    if (button.hasAttribute("data-mobile-close")) {
      setOpen(false);
      return true;
    }
    if (button.hasAttribute("data-mobile-tools")) {
      const expanded = !root.classList.contains("mobile-tools-open");
      root.classList.toggle("mobile-tools-open", expanded);
      button.setAttribute("aria-expanded", String(expanded));
      return true;
    }
    if (button.closest(".sidebar")) setOpen(false);
    return false;
  }
  function close() {
    if (!root.classList.contains("mobile-menu-open")) return false;
    setOpen(false);
    return true;
  }
  document.addEventListener("keydown", (event) => {
    if (!root.classList.contains("mobile-menu-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      const buttons = [
        ...root.querySelectorAll(".sidebar button:not(:disabled)"),
      ];
      const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
      }
    }
  });
  narrow.addEventListener("change", () => setOpen(false));
  return { decorate, handle, close };
}
