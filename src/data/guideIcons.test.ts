import { describe, expect, it } from "vitest";
import { cropKey, textureKey, type GuideIcon } from "../../packages/data-contract/guideIcons.ts";
import { guideIconCatalog } from "./guideIcons.ts";
import { guideIconsFixture } from "./manifestFixture.ts";

const catalog = guideIconCatalog(guideIconsFixture().guideIcons);

describe("guideIconCatalog", () => {
  it("names each icon by its file name and puts it in the category of the name's prefix", () => {
    expect(catalog.all.map(({ id, name, category }) => [id, name, category])).toEqual([
      [132121, "ability druid demoralizingroar", "ability"],
      [308474, "chatbubble 64grey", "chatbubble"],
      [7792229, "inv knife 1h skybornec60 b 01", "inv"],
    ]);
    expect(catalog.categories).toEqual(["ability", "chatbubble", "inv"]);
    const other = guideIconCatalog({
      ...guideIconsFixture().guideIcons,
      icons: [{ fileDataId: 5, path: textureKey("ui/flightstone-blue")! }],
    });
    expect(other.all.map(({ name, category }) => [name, category])).toEqual([["flightstone blue", "other"]]);
  });

  it("finds an icon by its FileDataID and by its path as a guide writes it", () => {
    const knife = catalog.all.find((entry) => entry.id === 7792229)!;
    expect(catalog.get(textureKey("7792229"))).toBe(knife);
    expect(catalog.get(textureKey("Interface/Icons/inv_knife_1h_skybornec60_b_01.blp"))).toBe(knife);
    expect(catalog.get(textureKey("134414"))).toBeUndefined();
    expect(knife.cell).toEqual({ x: 2, y: 70, width: 64, height: 64 });
  });

  it("finds a part of a file only by its crop key, and leaves it out of the icons that guides name", () => {
    const file = guideIconsFixture().guideIcons;
    const [roar, bubble, knife] = file.icons as [GuideIcon, GuideIcon, GuideIcon];
    const crop = { width: 128, height: 128, left: 63, right: 72, top: 0, bottom: 4 };
    const icons = guideIconCatalog({ ...file, icons: [roar, bubble, { ...bubble, crop }, knife] });
    expect(icons.get(cropKey(308474, crop))?.cell).toEqual({ x: 2, y: 70, width: 64, height: 64 });
    expect(icons.get(textureKey("308474"))?.cell).toEqual({ x: 70, y: 2, width: 64, height: 64 });
    expect(icons.get(textureKey("interface/worldmap/chatbubble_64grey"))?.cell).toEqual({ x: 70, y: 2, width: 64, height: 64 });
    expect(icons.all.map((entry) => entry.id)).toEqual([132121, 308474, 7792229]);
    expect(icons.get(cropKey(308474, { ...crop, left: 45, right: 54 }))).toBeUndefined();
  });

  it("searches the name, the path, and the ID with every word", () => {
    const ids = (query: string) => catalog.search(query).map((entry) => entry.id);
    expect(ids("")).toEqual([132121, 308474, 7792229]);
    expect(ids("KNIFE 1h")).toEqual([7792229]);
    expect(ids("worldmap")).toEqual([308474]);
    expect(ids("chatbubble_64")).toEqual([308474]);
    expect(ids("1321")).toEqual([132121]);
    expect(ids("knife druid")).toEqual([]);
  });

  it("finds an icon by the names that guides write after it", () => {
    const file = guideIconsFixture().guideIcons;
    const icons = guideIconCatalog({
      ...file,
      icons: [...file.icons, { fileDataId: 134414, path: textureKey("interface/icons/inv_misc_rune_01")! }],
    });
    const names = icons.iconNames(
      new Map([
        [textureKey("134414")!, ["Hearthstone"]],
        [textureKey("Interface/Icons/INV_Misc_Rune_01.blp")!, ["Hearthstone", "Rune of Return"]],
        [textureKey("5")!, ["Not an icon"]],
      ]),
    );
    expect([...names].map(([entry, list]) => [entry.id, list])).toEqual([[134414, ["Hearthstone", "Rune of Return"]]]);
    const ids = (query: string, given?: typeof names) => icons.search(query, given).map((entry) => entry.id);
    expect(ids("HEARTH", names)).toEqual([134414]);
    expect(ids("return rune", names)).toEqual([134414]);
    expect(ids("hearth")).toEqual([]);
    expect(ids("i", names)).toEqual([132121, 308474, 7792229, 134414]);
  });

  it("is empty for a release with no guide icons table", () => {
    const empty = guideIconCatalog(undefined);
    expect([empty.all, empty.categories, empty.get(textureKey("132121"))]).toEqual([[], [], undefined]);
  });
});
