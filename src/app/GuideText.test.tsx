// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EntityIndex } from "../data/index.ts";
import { guideIconCatalog } from "../data/guideIcons.ts";
import { guideIconsFixture } from "../data/manifestFixture.ts";
import { guideText } from "../guide/index.ts";
import { EntityContext, GuideIconsContext } from "./context.ts";
import { GuideText } from "./GuideText.tsx";

afterEach(cleanup);

const index = new EntityIndex({
  version: 2,
  entities: {
    item: [[6948, "Hearthstone"]],
    quest: [[33, "Wolves Across the Border"]],
    npc: [[196, "Eagan Peltskinner"]],
    spell: [[133, "Fireball"]],
    object: [[1617, "Silverleaf"]],
  },
});
const catalog = guideIconCatalog(guideIconsFixture().guideIcons);

function show(text: string, links: "plain" | "entity", colors = false) {
  const parts = guideText(text, (type, id) => index.lookup(type, id)?.name, { colors });
  return render(
    <EntityContext.Provider value={index}>
      <GuideIconsContext.Provider value={{ catalog, sheet: undefined }}>
        <p>
          <GuideText parts={parts} links={links} />
        </p>
      </GuideIconsContext.Provider>
    </EntityContext.Provider>,
  ).container;
}

it("links each reference in text as RXP shows it", () => {
  const shown = show(
    "Use Hearthstone (item #6948), see |cRXP_FRIENDLY_Eagan::196|r and npc:Bob:240. Loot |cRXP_LOOT_Silverleaf|r",
    "entity",
  );
  expect(shown.textContent).toBe("Use Hearthstone (item #6948), see Eagan Peltskinner and Bob. Loot Silverleaf");
  expect(screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Hearthstone (item #6948)", "https://www.wowhead.com/forever/item=6948"],
    ["Eagan Peltskinner", "https://www.wowhead.com/forever/npc=196"],
    ["Bob", "https://www.wowhead.com/forever/npc=240"],
  ]);
});

it("shows each texture as a named icon at its size, cropped from the sheet, and names an unknown one by its key", () => {
  show("|TInterface/Icons/INV_Knife_1h_SkybornEc60_b_01:20|tUse |T134414:0|t(item #6948)", "plain");
  expect(screen.queryAllByRole("link")).toEqual([]);
  const [knife, unknown] = screen.getAllByRole("img");
  const declarations = ({ style }: HTMLElement) => Object.fromEntries([...style].map((name) => [name, style.getPropertyValue(name)]));
  expect([knife!.getAttribute("aria-label"), knife!.className, declarations(knife!)]).toEqual([
    "inv knife 1h skybornec60 b 01",
    "guide-icon framed",
    {
      "--icon-w": "20px",
      "--icon-h": "20px",
      "--icon-ratio": "1",
      "--sheet-w": "2.125",
      "--sheet-h": "2.125",
      "--cell-x": "-0.03125",
      "--cell-y": "-1.09375",
    },
  ]);
  expect([unknown!.getAttribute("aria-label"), unknown!.className, declarations(unknown!)]).toEqual([
    "Icon 134414",
    "guide-icon missing",
    { "--icon-w": "1em", "--icon-h": "1em" },
  ]);
  expect(screen.getByText(/Use/).textContent).toBe("Use (item #6948)");
});

it("draws a texture's vector icon by its path, or by its FileDataID through the catalog, unless its arguments crop the file", () => {
  show(
    "|TInterface\\Cursor\\Crosshair\\Interact:16|t Talk |T308474:0|t |T308474:16:16:0:0:64:64:0:32:0:32|t |TInterface\\GossipFrame\\AvailableQuestIcon:16|t",
    "plain",
  );
  const icons = screen
    .getAllByRole("img")
    .map((img) => [img.getAttribute("aria-label"), img.className, img.style.getPropertyValue("--icon-url")]);
  expect(icons).toEqual([
    ["Icon Interface\\Cursor\\Crosshair\\Interact", "guide-icon vector", 'url("/src/app/guideIcons/interact.svg?no-inline")'],
    ["chatbubble 64grey", "guide-icon vector", 'url("/src/app/guideIcons/talk.svg?no-inline")'],
    ["Icon 308474", "guide-icon missing", ""],
    ["Icon Interface\\GossipFrame\\AvailableQuestIcon", "guide-icon vector vivid", 'url("/src/app/guideIcons/accept.svg?no-inline")'],
  ]);
});

it("shows colored text and a colored reference in their RXP colors", () => {
  show("|cRXP_WARN_Sell to |cRXP_FRIENDLY_Eagan::196|r|r", "entity", true);
  const colored = [...document.querySelectorAll<HTMLElement>(".rxp-colored")];
  expect(colored.map((span) => [span.textContent, span.dataset.color])).toEqual([
    ["Sell to ", "WARN"],
    ["Eagan Peltskinner", "FRIENDLY"],
  ]);
  expect(screen.getByRole("link").textContent).toBe("Eagan Peltskinner");
});
