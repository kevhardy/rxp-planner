import { describe, expect, it } from "vitest";
import type { QuestPoint } from "../../packages/data-contract/model.ts";
import { mapToWorld, worldToCanvas, type WorldLocation } from "./maps.ts";
import { placeName } from "./places.ts";
import { MAP_BOUNDS, plannerData } from "./plannerFixture.ts";
import { terrainFixture } from "./terrainFixture.ts";

const data = plannerData();
const at = { instance: 0, ...mapToWorld(MAP_BOUNDS.get(1429)!, 48.2, 42) };
const north = (yards: number): WorldLocation => ({ ...at, y: at.y + yards });

const marshal = (world: WorldLocation): QuestPoint => ({
  zoneId: 12,
  uiMapId: 1429,
  world,
  x: 0,
  y: 0,
  kind: "start",
  sourceType: "npc",
  sourceId: 197,
  sourceName: "Marshal McBride",
});

function withLandmark(yards: number) {
  const label = worldToCanvas(data.terrainMap(terrainFixture), north(yards))!;
  const landmark = { name: "Northshire Abbey", kind: "landmark" as const, area: "eastern-kingdoms" as const, ...label, minZoom: 0 };
  return { ...terrainFixture, places: [...terrainFixture.places, landmark] };
}

describe("placeName", () => {
  it("names the NPC that stands at the place, with its zone", () => {
    expect(placeName(data, withLandmark(10), at, [marshal(north(20))])).toBe("Marshal McBride, Elwynn Forest");
  });

  it("names a nearby landmark when no NPC stands there", () => {
    expect(placeName(data, withLandmark(60), at, [marshal(north(40))])).toBe("Northshire Abbey, Elwynn Forest");
  });

  it("falls back to the zone and its map coordinates", () => {
    expect(placeName(data, withLandmark(150), at, [])).toBe("Elwynn Forest 48.2, 42.0");
  });
});
