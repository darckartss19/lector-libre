// Adapt older UI fixtures to the native incremental persistence contract.
export async function installStateBridge(page, { platform = null } = {}) {
  await page.addInitScript(
    ({ platform }) => {
      let bridge,
        state,
        pendingImport = JSON.parse(
          sessionStorage.getItem("fixture-import-queue") || "null",
        );
      const spines = new Map();
      const apply = (old, change) => {
        const value = { ...old, ...change.set };
        for (const key of change.remove) delete value[key];
        return value;
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        get: () => bridge,
        set: (value) => {
          const invoke = value.invoke;
          value.invoke = async (command, args) => {
            if (command === "platform_info" && platform) {
              // Opt-in capabilities for legacy fixtures; public/mobile fixtures supply their own.
              return {
                platform,
                mobile: platform === "android",
                speech: true,
                drive: true,
                imageClipboard: true,
              };
            }
            // Older fixtures keep inline covers; native-reference coverage has its own fixture.
            if (command === "store_cover") return args.cover;
            if (command === "import_queue") {
              if (args.clear) pendingImport = null;
              else if (args.value) pendingImport = structuredClone(args.value);
              sessionStorage.setItem(
                "fixture-import-queue",
                JSON.stringify(pendingImport),
              );
              return structuredClone(pendingImport);
            }
            if (command === "spine_asset") {
              if (args.design)
                spines.set(args.hash, structuredClone(args.design));
              return spines.get(args.hash) ?? null;
            }
            if (command === "save_state" && args.patch) {
              const patch = args.patch;
              (window.patchSizes ??= []).push(JSON.stringify(patch).length);
              const books = new Map(state.books.map((book) => [book.id, book]));
              for (const change of patch.books)
                books.set(change.id, apply(books.get(change.id), change));
              args = {
                value: {
                  ...apply(state, patch.top),
                  books: (
                    patch.order ?? state.books.map((book) => book.id)
                  ).map((id) => books.get(id)),
                  registers: apply(state.registers, patch.registers),
                },
              };
            }
            const result = await invoke(command, args);
            if (command === "load_state") state = result;
            if (command === "save_state") state = args.value;
            return result;
          };
          bridge = value;
        },
      });
    },
    { platform },
  );
}
