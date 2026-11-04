import { AssetMap, Latest, type Retains, type Status } from "./async.ts";

// https://www.wowhead.com/tooltips
const TOOLTIPS_SCRIPT = "https://wow.zamimg.com/js/tooltips.js";

function addScript(): Promise<void> {
  // React owns the links' text, so the script must not rename, color, or iconize them.
  Object.assign(window, { whTooltips: { colorLinks: false, iconizeLinks: false, renameLinks: false } });
  const script = document.createElement("script");
  script.src = TOOLTIPS_SCRIPT;
  script.async = true;
  const added = new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Wowhead's tooltip script did not load."));
    };
  });
  document.head.append(script);
  return added;
}

/**
 * Wowhead's tooltip script and item icons, once per page. The first retain,
 * of `"tooltips"` or of an icon, adds the script, and nothing adds it again.
 *
 * Item icons come from Wowhead's tooltip API, which names each item's icon,
 * and its image CDN. The planner's data has none. An icon waits for the
 * script, so a page without Wowhead makes no requests. Each item is asked
 * for once per page.
 */
class Wowhead implements Retains<"tooltips"> {
  readonly #script = new Latest<void>();
  #added: Promise<void> | undefined;

  subscribe = this.#script.subscribe;

  getState = (): Status<void>["kind"] => this.#script.getState().kind;

  /** Icon names by item ID; null when Wowhead names none, the request failed, or the script did not load. */
  readonly icons = new AssetMap<number, string | null>(async (id) => {
    try {
      await (this.#added ??= this.#add());
      const response = await fetch(`https://nether.wowhead.com/forever/tooltip/item/${id}`);
      const body = response.ok ? ((await response.json()) as { icon?: unknown }) : null;
      return typeof body?.icon === "string" ? body.icon : null;
    } catch {
      return null;
    }
  });

  retain(): () => void {
    this.#added ??= this.#add();
    return () => {};
  }

  #add(): Promise<void> {
    const added = addScript();
    this.#script.run(() => added);
    return added;
  }
}

export const wowhead = new Wowhead();
