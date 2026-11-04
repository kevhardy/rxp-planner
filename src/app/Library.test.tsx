// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Builtins } from "../io/index.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { StoresContext } from "./context.ts";
import { EditorDock } from "./EditorDock.tsx";
import { LibraryDrawer } from "./Library.tsx";
import { createStores } from "./stores.ts";
import { showLine } from "./testing.ts";

afterEach(() => cleanup());

const twoGuides: StoredLibrary = {
  guides: [
    { id: "a", text: "#group Mine\n#name A\nstep\n", order: 0 },
    { id: "b", text: "#group Mine\n#name B\nstep\n", order: 1 },
  ],
  session: { guideId: "a", step: null, line: null },
};

function mount(library?: StoredLibrary, options: { builtins?: Builtins; onClose?: () => void; beside?: ReactNode } = {}) {
  const stores = createStores(library, options.builtins);
  render(
    <StoresContext.Provider value={stores}>
      <div id="app">
        <LibraryDrawer open onClose={options.onClose ?? (() => {})} />
        {options.beside}
      </div>
    </StoresContext.Provider>,
  );
  return { stores, user: userEvent.setup() };
}

const library = () => screen.getByRole("navigation", { name: "Library" });

describe("LibraryDrawer", () => {
  it("shows an invalid new name in the dialog without losing it", async () => {
    const { user } = mount();
    await user.click(screen.getByRole("button", { name: "New group" }));
    const dialog = screen.getByRole("dialog", { name: "New group" });
    await user.type(within(dialog).getByLabelText("Group name"), "Test -- keep this{Enter}");
    expect(within(dialog).getByRole("alert").textContent).toMatch(/RXP would read/);
    expect(within(dialog).getByLabelText("Group name")).toHaveProperty("value", "Test -- keep this");
    screen.getByText("Your guides");
  });

  it("creates a group with one new guide and opens it", async () => {
    const { stores, user } = mount();
    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(within(screen.getByRole("dialog", { name: "New group" })).getByLabelText("Group name"), "Test{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    const group = screen.getByRole("region", { name: "Group Test" });
    expect(
      within(group)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".lib-name")!.textContent),
    ).toEqual(["New guide"]);
    expect(stores.editor.getState().current!.record.text).toBe("#group Test\n#name New guide\nstep\n");
  });

  it("leaves an Escape to its dialog and closes on the next Escape", async () => {
    let closes = 0;
    const { user } = mount(twoGuides, { onClose: () => closes++ });
    await user.click(within(library()).getByRole("button", { name: "New group" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closes).toBe(0);

    await user.keyboard("{Escape}");
    expect(closes).toBe(1);
  });

  it("keeps Tab and Shift+Tab inside the open library drawer", async () => {
    const { user } = mount(twoGuides);
    const first = within(library()).getByRole("button", { name: "New group" });
    const last = within(library()).getByRole("button", { name: "About" });

    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it("keeps the source link in the library footer and names both versions under About, with links", async () => {
    vi.stubEnv("VITE_APP_VERSION", JSON.stringify({ name: "v1.2.3", url: "https://example.test/tree/v1.2.3" }));
    vi.stubEnv("VITE_DATASET_VERSION", JSON.stringify({ name: "data-0123456789ab", url: "https://example.test/data" }));
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const { user } = mount();
    const footer = library().querySelector("footer")!;

    expect(within(footer).getByRole("link", { name: "Source code" }).getAttribute("href")).toBe("https://example.test/tree/v1.2.3");
    expect(within(footer).queryByRole("link", { name: "v1.2.3" })).toBeNull();

    await user.click(within(footer).getByRole("button", { name: "About" }));
    const about = within(footer).getByRole("region", { name: "About" });
    expect(about.textContent).toBe("Plannerv1.2.3Dataset0123456789ab");
    expect(within(about).getByRole("link", { name: "v1.2.3" }).getAttribute("href")).toBe("https://example.test/tree/v1.2.3");
    expect(within(about).getByRole("link", { name: "0123456789ab" }).getAttribute("href")).toBe("https://example.test/data");
    expect(footer.querySelector("[title]")).toBeNull();
  });

  it("keeps typing in the #name line after the first edit renames the copy", async () => {
    const builtins: Builtins = {
      version: "v9.9.9",
      guides: [{ id: "rxp:test.lua#1", text: "#group Test Group\n#name A\nstep\n    .accept 1 >>Hello\n", order: 0, fileName: "test.lua" }],
    };
    const { user } = mount(
      { guides: [], session: { guideId: "rxp:test.lua#1", step: null, line: null } },
      { builtins, beside: <EditorDock /> },
    );
    const name = within(await showLine(user, 2)).getByLabelText("Line text");
    await user.type(name, "bc{Enter}def{Enter}");

    expect(document.activeElement).toBe(name);
    expect(name).toHaveProperty("value", "#name Abcdef");
    expect(
      within(library())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Abcdef")]);
  });
});
