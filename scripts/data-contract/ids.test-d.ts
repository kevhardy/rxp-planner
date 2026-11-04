import { expectTypeOf } from "vitest";
import type { InstanceId, QuestPoint, UiMapId, ZoneId } from "../../packages/data-contract/index.ts";

expectTypeOf({ zoneId: 12, uiMapId: 1429, world: { instance: 0, x: 1, y: 2 } }).toExtend<
  Pick<QuestPoint, "zoneId" | "uiMapId" | "world">
>();

expectTypeOf<ZoneId>().not.toExtend<UiMapId>();
expectTypeOf<ZoneId>().not.toExtend<InstanceId>();
expectTypeOf<UiMapId>().not.toExtend<ZoneId>();
expectTypeOf<UiMapId>().not.toExtend<InstanceId>();
expectTypeOf<InstanceId>().not.toExtend<ZoneId>();
expectTypeOf<InstanceId>().not.toExtend<UiMapId>();
