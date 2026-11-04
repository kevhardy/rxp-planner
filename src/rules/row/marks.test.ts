import { expect, it } from "vitest";
import { markTextureKeys } from "./marks.ts";

it("names each mark texture once for the textures export", () => {
  expect(markTextureKeys()).toEqual([
    "136441:128:128:45:54:0:4",
    "136441:128:128:63:72:0:4",
    "136441:128:128:72:81:0:4",
    "interface/buttons/ui-grouploot-pass-up",
    "interface/cursor/attack",
    "interface/cursor/vehichlecursor",
    "interface/gossipframe/activequesticon",
    "interface/gossipframe/auctioneergossipicon",
    "interface/gossipframe/availablequesticon",
    "interface/gossipframe/bankergossipicon",
    "interface/gossipframe/dailyactivequesticon",
    "interface/gossipframe/dailyquesticon",
    "interface/gossipframe/gossipgossipicon",
    "interface/gossipframe/petitiongossipicon",
    "interface/gossipframe/taxigossipicon",
    "interface/gossipframe/trainergossipicon",
    "interface/gossipframe/vendorgossipicon",
    "interface/icons/ability_hunter_beasttaming",
    "interface/icons/achievement_reputation_01",
    "interface/icons/inv_misc_map_01",
    "interface/icons/inv_misc_rune_01",
    "interface/icons/inv_misc_rune_06",
    "interface/minimap/tracking/banker",
    "interface/minimap/tracking/flightmaster",
    "interface/minimap/tracking/profession",
    "interface/minimap/tracking/stablemaster",
    "interface/paperdollinfoframe/ui-equipmentmanager-toggle",
    "interface/petbattles/battlebar-abilitybadge-strong-small",
    "interface/raidframe/readycheck-notready",
    "interface/tooltips/reforgegreenarrow",
  ]);
});
