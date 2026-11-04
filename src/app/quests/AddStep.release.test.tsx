// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EntityIndex, GameData } from "../../data/index.ts";
import { releaseData, releaseEntities } from "../../data/releaseInputs.ts";
import { EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { StepList } from "../StepList.tsx";
import { createStores, DEFAULT_SAVED_SETTINGS } from "../stores.ts";

afterEach(() => cleanup());

let forever: { data: GameData; entities: EntityIndex };
beforeAll(() => {
  forever = { data: releaseData(), entities: releaseEntities() };
});

const guide = `#group G
#name Sim
step
    .accept 783
    .accept 5261
step
    .accept 33
step
    >> Later
`;

function mount(options: { data: GameData }) {
  const stores = createStores({ guides: [{ id: "g", text: guide, order: 0 }], session: { guideId: "g", step: 1, line: null } }, null, {
    ...DEFAULT_SAVED_SETTINGS,
    preview: { ...DEFAULT_SETTINGS, startLevel: { level: 2, xp: 0 } },
  });
  render(
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={options.data}>
        <EntityContext.Provider value={forever.entities}>
          <StepList />
        </EntityContext.Provider>
      </GameDataContext.Provider>
    </StoresContext.Provider>,
  );
  const user = userEvent.setup();
  const open = async () => {
    await user.click(screen.getByRole("button", { name: "Add step" }));
    return screen.getByRole("dialog");
  };
  return { user, open };
}

describe("Add step popover", () => {
  it("filters to the current zone or all zones, and sorts by distance, level, or XP", async () => {
    const { open, user } = mount({ data: forever.data });
    const dialog = await open();
    const group = (name: string) => within(dialog).getByRole("region", { name });
    const note = (name: string) => group(name).querySelector(".add-note")?.textContent;
    const zone = within(dialog).getByLabelText("Zone");
    expect((zone as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Elwynn Forest");
    const accepts = () => [...dialog.querySelectorAll(".add-accept .add-name")].map((n) => n.textContent);
    expect(note("Can accept")).toBe("Showing 50 of 60. Choose a zone or sort to see others.");
    expect(accepts()).not.toContain("Dwarven Outfitters · Sten Stoutarm");

    const sort = within(dialog).getByLabelText("Sort");
    await user.selectOptions(sort, "xp");
    expect(accepts().slice(0, 2)).toEqual([
      "Archmage Theocritus' Research Journal · Library Book",
      "Rest and Relaxation · Falkhaan Isenstrider",
    ]);
    await user.selectOptions(sort, "level");
    expect(accepts().slice(0, 2)).toEqual(["Nibbled-On Book · Nibbled-On Book", "Rest and Relaxation · Falkhaan Isenstrider"]);

    await user.selectOptions(zone, "all");
    expect(note("Can accept")).toBe("Showing 50 of 2,306. Choose a zone or sort to see others.");
    expect(accepts()).toContain("Dwarven Outfitters · Sten Stoutarm");
  });
});
