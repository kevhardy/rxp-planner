// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityIndex } from "../data/index.ts";
import { entityNames } from "./EntityLink.tsx";
import { questNames } from "./testing.ts";

const index = new EntityIndex({
  version: 2,
  entities: {
    item: [[6948, "Hearthstone"]],
    quest: [[33, "Wolves Across the Border"]],
    npc: [[196, "Eagan Peltskinner"]],
    spell: [[133, "Fireball", "Rank 1"]],
    object: [[1617, "Silverleaf"]],
  },
});

async function load() {
  vi.resetModules();
  const [{ EntityLink, ItemIcon }, { EntityContext, GameDataContext }] = await Promise.all([
    import("./EntityLink.tsx"),
    import("./context.ts"),
  ]);
  return { EntityLink, ItemIcon, EntityContext, GameDataContext };
}

const scripts = () => document.head.querySelectorAll<HTMLScriptElement>('script[src="https://wow.zamimg.com/js/tooltips.js"]');
const tip = () => screen.queryByRole("tooltip");

beforeEach(() => {
  fireEvent.pointerDown(document);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  delete (window as { whTooltips?: unknown }).whTooltips;
});

describe("EntityLink", () => {
  it("links each type to Wowhead Forever with its name and rank", async () => {
    const { EntityLink, EntityContext, GameDataContext } = await load();
    render(
      <EntityContext.Provider value={index}>
        <GameDataContext.Provider value={questNames([[33, "Wolves Across the Border"]])}>
          <EntityLink type="item" id={6948} />
          <EntityLink type="quest" id={33} />
          <EntityLink type="npc" id={196} />
          <EntityLink type="spell" id={133} />
          <EntityLink type="object" id={1617} />
        </GameDataContext.Provider>
      </EntityContext.Provider>,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Hearthstone", "https://www.wowhead.com/forever/item=6948"],
      ["Wolves Across the Border", "https://www.wowhead.com/forever/quest=33"],
      ["Eagan Peltskinner", "https://www.wowhead.com/forever/npc=196"],
      ["Fireball Rank 1", "https://www.wowhead.com/forever/spell=133"],
      ["Silverleaf", "https://www.wowhead.com/forever/object=1617"],
    ]);
    expect(links.every((a) => a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noreferrer")).toBe(true);
    expect(
      screen.getByRole("link", {
        name: "Fireball Rank 1",
        description: "Fireball (Rank 1) · spell 133. Opens on Wowhead.",
      }),
    ).toBeTruthy();
  });

  it("links unknown IDs by type and ID and renders invalid IDs as text", async () => {
    const { EntityLink, EntityContext } = await load();
    render(
      <>
        <EntityContext.Provider value={index}>
          <EntityLink type="item" id={99999} />
          <EntityLink type="item" id={0} />
          <EntityLink type="quest" id={-33} />
          <EntityLink type="npc" id={1.5} />
        </EntityContext.Provider>
        <EntityLink type="item" id={6948} />
        <EntityLink type="quest" id={79000} name="A quest the data lacks" />
      </>,
    );
    expect(screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["item #99999", "https://www.wowhead.com/forever/item=99999"],
      ["item #6948", "https://www.wowhead.com/forever/item=6948"],
      ["A quest the data lacks", "https://www.wowhead.com/forever/quest=79000"],
    ]);
    expect(screen.getByRole("link", { name: "item #99999" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("link", { name: "item #99999", description: /^item 99999, not in the bundled data\./ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "item #6948", description: /^item 6948\./ })).toBeTruthy();
    expect(screen.getByText("item #0").closest("a")).toBeNull();
    expect(screen.getByText("quest #-33").closest("a")).toBeNull();
    expect(screen.getByText("npc #1.5").closest("a")).toBeNull();
  });

  it("loads Wowhead's script once and hands it hover once loaded", async () => {
    const { EntityLink, EntityContext } = await load();
    const user = userEvent.setup();
    const view = render(
      <EntityContext.Provider value={index}>
        <EntityLink type="item" id={6948} />
        <EntityLink type="spell" id={133} />
      </EntityContext.Provider>,
    );
    expect(scripts()).toHaveLength(1);
    expect((window as { whTooltips?: unknown }).whTooltips).toEqual({ colorLinks: false, iconizeLinks: false, renameLinks: false });
    const hearth = () => screen.getByRole("link", { name: "Hearthstone" });

    await user.hover(hearth());
    expect(tip()?.textContent).toMatch(/^Hearthstone · item 6948\./);
    await act(() => scripts()[0]!.dispatchEvent(new Event("load")));
    expect(tip()).toBeNull();
    await user.unhover(hearth());
    await user.hover(hearth());
    expect(tip()).toBeNull();
    await user.unhover(hearth());
    // The script ignores focus, so keyboard focus keeps the description, and Escape hides it.
    await user.tab();
    expect(document.activeElement).toBe(hearth());
    expect(tip()?.textContent).toMatch(/^Hearthstone/);
    await user.keyboard("{Escape}");
    expect(tip()).toBeNull();
    // With `renameLinks: false`, the script leaves the link text to React.
    expect(hearth().textContent).toBe("Hearthstone");

    view.unmount();
    render(<EntityLink type="item" id={6948} />);
    expect(scripts()).toHaveLength(1);
  });

  it("keeps working links with their own descriptions when the script fails", async () => {
    const { EntityLink } = await load();
    const user = userEvent.setup();
    const view = render(<EntityLink type="npc" id={196} />);
    await act(() => scripts()[0]!.dispatchEvent(new Event("error")));
    expect(scripts()).toHaveLength(0);
    await user.hover(screen.getByRole("link"));
    expect(tip()?.textContent).toBe("npc 196. Opens on Wowhead.");

    view.unmount();
    render(<EntityLink type="npc" id={196} />);
    expect(scripts()).toHaveLength(0);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://www.wowhead.com/forever/npc=196");
  });
});

describe("ItemIcon", () => {
  const icon = () => document.querySelector("img")!;

  it("asks Wowhead for the item's icon once its script loads, once per page", async () => {
    const { ItemIcon, EntityContext } = await load();
    const fetch = vi.fn(async () => Response.json({ name: "Hearthstone", icon: "inv_misc_rune_01" }));
    vi.stubGlobal("fetch", fetch);
    const view = render(
      <EntityContext.Provider value={index}>
        <ItemIcon id={6948} count={5} />
      </EntityContext.Provider>,
    );
    expect(screen.getByRole("link", { name: "Hearthstone ×5" }).getAttribute("href")).toBe("https://www.wowhead.com/forever/item=6948");
    expect(icon().getAttribute("src")).toBe("https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg");
    expect(fetch).not.toHaveBeenCalled();

    await act(() => scripts()[0]!.dispatchEvent(new Event("load")));
    await waitFor(() => expect(icon().getAttribute("src")).toBe("https://wow.zamimg.com/images/wow/icons/medium/inv_misc_rune_01.jpg"));
    expect(fetch).toHaveBeenCalledWith("https://nether.wowhead.com/forever/tooltip/item/6948");

    view.unmount();
    render(<ItemIcon id={6948} named />);
    expect(icon().getAttribute("src")).toBe("https://wow.zamimg.com/images/wow/icons/medium/inv_misc_rune_01.jpg");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads each item's icon retained before the script is ready once, after the script loads", async () => {
    const { EntityLink, ItemIcon } = await load();
    const fetch = vi.fn(async (url: string) => Response.json({ icon: url.endsWith("/6948") ? "inv_misc_rune_01" : "inv_misc_bag_07" }));
    vi.stubGlobal("fetch", fetch);
    const view = render(<EntityLink type="npc" id={196} />);
    view.rerender(
      <>
        <EntityLink type="npc" id={196} />
        <ItemIcon id={6948} />
        <ItemIcon id={6948} named />
        <ItemIcon id={4496} />
      </>,
    );
    expect(fetch).not.toHaveBeenCalled();

    await act(() => scripts()[0]!.dispatchEvent(new Event("load")));
    const sources = () => [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    await waitFor(() =>
      expect(sources()).toEqual([
        "https://wow.zamimg.com/images/wow/icons/medium/inv_misc_rune_01.jpg",
        "https://wow.zamimg.com/images/wow/icons/medium/inv_misc_rune_01.jpg",
        "https://wow.zamimg.com/images/wow/icons/medium/inv_misc_bag_07.jpg",
      ]),
    );
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://nether.wowhead.com/forever/tooltip/item/6948",
      "https://nether.wowhead.com/forever/tooltip/item/4496",
    ]);
  });

  it("keeps the question mark for an icon that failed, and does not ask again", async () => {
    const { ItemIcon } = await load();
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<ItemIcon id={6948} />);
    await act(() => scripts()[0]!.dispatchEvent(new Event("load")));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {});
    render(<ItemIcon id={6948} />);
    await act(async () => {});
    expect(document.querySelector("img")!.getAttribute("src")).toBe(
      "https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the plain link when Wowhead's script fails, and asks for no icon", async () => {
    const { ItemIcon, EntityContext } = await load();
    const fetch = vi.fn(async () => Response.json({ icon: "inv_misc_rune_01" }));
    vi.stubGlobal("fetch", fetch);
    render(
      <EntityContext.Provider value={index}>
        <ItemIcon id={6948} count={5} />
      </EntityContext.Provider>,
    );
    await act(() => scripts()[0]!.dispatchEvent(new Event("error")));
    await act(async () => {});
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("link").parentElement!.textContent).toBe("Hearthstone ×5");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names an item the data lacks by its fallback, with or without Wowhead's script", async () => {
    const { ItemIcon } = await load();
    render(<ItemIcon id={16735} name="Bracers of Valor" named />);
    expect(screen.getByRole("link").textContent).toBe("Bracers of Valor");
    await act(() => scripts()[0]!.dispatchEvent(new Event("error")));
    expect(screen.getByRole("link").textContent).toBe("Bracers of Valor");
  });
});

describe("entityNames", () => {
  const stale = new EntityIndex({
    version: 2,
    entities: {
      item: [
        [6948, "Hearthstone"],
        [2589, "Linen Cloth"],
      ],
      quest: [
        [990001, "Wolves (indexed)"],
        [990002, "Boars (indexed)"],
      ],
      npc: [],
      spell: [],
      object: [],
    },
  });
  const data = questNames([
    [990001, "Wolves (data)"],
    [12, "Wolves' Pelts"],
    [7, "Wolves"],
    [8, "Grey Wolves"],
    [9, "Wolves"],
    [5, "Wolves 12"],
  ]);

  it("looks up and searches quests in the game data, never the index", () => {
    const names = entityNames(stale, false, data);
    expect(names.lookup("quest", 990001)).toEqual({ type: "quest", id: 990001, name: "Wolves (data)" });
    expect(names.lookup("quest", 990002)).toBeUndefined();
    expect(names.search("quest", "indexed", 20)).toEqual([]);
    expect(names.search("quest", "boars", 20)).toEqual([]);
    expect(names.lookup("item", 6948)).toEqual({ type: "item", id: 6948, name: "Hearthstone" });
    expect(names.search("item", "linen", 20)).toEqual([{ type: "item", id: 2589, name: "Linen Cloth" }]);
  });

  it("ranks quests by ID, exact name, then name prefix, by name and then ID, up to the limit", () => {
    const names = entityNames(stale, false, data);
    const ids = (query: string, limit = 20) => names.search("quest", query, limit)!.map((e) => e.id);
    expect(ids(" WOLVES ")).toEqual([7, 9, 990001, 5, 12, 8]);
    expect(ids("wolves", 2)).toEqual([7, 9]);
    expect(ids("12")).toEqual([12, 5]);
    expect(ids(" ")).toEqual([]);
  });

  it("gives null while a source loads, and each source's status", () => {
    const loading = entityNames(null, false, null);
    expect([loading.lookup("quest", 990001), loading.search("quest", "wolves", 20)]).toEqual([null, null]);
    expect([loading.lookup("item", 6948), loading.search("item", "linen", 20)]).toEqual([null, null]);
    expect([loading.status("quest"), loading.status("quest", true), loading.status("item")]).toEqual([
      "Loading quest data…",
      "Loading quest data…",
      "Loading names…",
    ]);

    const failed = entityNames(null, true, null);
    expect([failed.status("quest"), failed.status("quest", true), failed.status("item")]).toEqual([
      "Quest data unavailable.",
      "Quest data unavailable. Enter an ID.",
      "Names failed to load. Enter an ID.",
    ]);

    const questsOnly = entityNames(null, true, data);
    expect([questsOnly.status("quest", true), questsOnly.lookup("quest", 7)?.name, questsOnly.status("item")]).toEqual([
      undefined,
      "Wolves",
      "Names failed to load. Enter an ID.",
    ]);
    expect([entityNames(stale, false, null).status("item"), entityNames(stale, false, null).status("quest")]).toEqual([
      undefined,
      "Loading quest data…",
    ]);
  });
});
