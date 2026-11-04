// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoresContext } from "../context.ts";
import { createStores } from "../stores.ts";
import { cascade } from "../ui/testing.ts";
import { PlaybackSettingsMenu } from "./PlaybackSettingsMenu.tsx";

afterEach(cleanup);

vi.mock("../../rules/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rules/index.ts")>();
  const probe = { kind: "probe", label: "Probe", description: "A setting of an unknown kind.", default: false };
  return { ...actual, PLAYBACK_SETTING_ENTRIES: [...actual.PLAYBACK_SETTING_ENTRIES, ["probe", probe]] };
});

async function open() {
  render(
    <StoresContext value={createStores()}>
      <PlaybackSettingsMenu />
    </StoresContext>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
}

it("shows no control for a setting of an unknown kind", async () => {
  await open();
  const rows = document.querySelectorAll(".playback-setting");
  expect(rows[0]!.querySelector("input")).not.toBeNull();
  const last = rows[rows.length - 1]!;
  expect([last.querySelector("input, select, button"), last.textContent]).toEqual([null, "A setting of an unknown kind."]);
});

it("ends the Ignore death skips label at its text, so a click on the blank space beside it does not toggle the setting", async () => {
  await open();
  const label = screen.getByRole("checkbox", { name: "Ignore death skips" }).closest("label")!;
  expect(cascade(label, "justify-self")?.value).toBe("start");
});
