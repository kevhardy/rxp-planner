// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Builtins } from "../io/index.ts";
import { createZip } from "../io/zip.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { StoresContext } from "./context.ts";
import { ImportDialog } from "./ImportDialog.tsx";
import { ImportReader } from "./importReader.ts";
import { createStores } from "./stores.ts";
import { slowFile } from "./testing.ts";

afterEach(() => cleanup());

function openDialog(files: File[], library: StoredLibrary, builtins: Builtins | null = null) {
  const stores = createStores(library, builtins);
  const reader = new ImportReader(stores.editor.getState().builtins);
  reader.add(files);
  render(
    <StoresContext.Provider value={stores}>
      <ImportDialog reader={reader} onClose={() => {}} />
    </StoresContext.Provider>,
  );
  return { reader, store: stores.editor, dialog: screen.getByRole("dialog", { name: "Import guide" }), user: userEvent.setup() };
}

async function importFiles(files: File[], library: StoredLibrary, builtins: Builtins | null = null) {
  const opened = openDialog(files, library, builtins);
  await within(opened.dialog).findByText(/^Found \d+ guides? in \d+ files?\.$/);
  return opened;
}

const importText = (text: string, library: StoredLibrary, builtins: Builtins | null = null) =>
  importFiles([new File([text], "guides.txt", { type: "text/plain" })], library, builtins);

const batch = (xp: number) => new File([`#group Batch\n#name Same\nstep\n.xp ${xp}\n`], `guide-${xp}.txt`, { type: "text/plain" });
const rowText = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
const texts = (store: Awaited<ReturnType<typeof importFiles>>["store"]) => [...store.getState().guides.values()].map((g) => g.text);

describe("ImportDialog", () => {
  it("says that the name is taken in your guides, and replaces the first stored guide with the entry's group and name", async () => {
    const stored = (id: string, order: number) => ({ id, order, text: "#group G\n#name Same\nstep\n" });
    const { store, dialog, user } = await importText("#group G\n#name Same\nstep\n.xp 9\n", {
      guides: [stored("first", 0), stored("second", 1)],
    });
    within(dialog).getByText("1 name is taken:");
    expect(within(dialog).getByRole("group", { name: "Name taken in your guides:" })).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: "Replace" }));
    await user.click(within(dialog).getByRole("button", { name: "Import 1 guide" }));
    const texts = Object.fromEntries([...store.getState().guides].map(([id, g]) => [id, g.text]));
    expect(texts).toEqual({ first: "#group G\n#name Same\nstep\n.xp 9\n", second: "#group G\n#name Same\nstep\n" });
  });

  it("asks for a choice when guides in one import share a name, and opens the later one after Replace", async () => {
    const { store, dialog, user } = await importFiles([batch(1), batch(2)], { guides: [] });
    within(dialog).getByText("Found 2 guides in 2 files.");
    const submit = within(dialog).getByRole("button", { name: "Import 2 guides" });
    expect(submit).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("group", { name: "Name taken in this import:" })).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: "Replace" }));
    await user.click(submit);
    expect(texts(store)).toEqual(["#group Batch\n#name Same\nstep\n.xp 2\n"]);
    expect(store.getState().current!.record.text).toBe("#group Batch\n#name Same\nstep\n.xp 2\n");
  });

  it("counts a name taken in your guides and a name taken in this import in one plural footer", async () => {
    const { dialog } = await importFiles([batch(1), batch(2)], {
      guides: [{ id: "g", order: 0, text: "#group Batch\n#name Same\nstep\n" }],
    });
    within(dialog).getByText("2 names are taken:");
    expect(within(dialog).getByRole("group", { name: "Name taken in your guides:" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Name taken in this import:" })).toBeTruthy();
  });

  it("lists a file it cannot read and imports the others", async () => {
    const unreadable = new File([""], "gone.txt", { type: "text/plain" });
    unreadable.arrayBuffer = () => Promise.reject(new Error("The file was moved."));
    const { store, dialog, user } = await importFiles([unreadable, batch(1)], { guides: [] });
    within(dialog).getByText("Found 1 guide in 2 files.");
    expect(within(dialog).getByRole("alert").textContent).toBe("gone.txt: The file was moved.");
    await user.click(within(dialog).getByRole("button", { name: "Import 1 guide" }));
    expect(texts(store)).toEqual(["#group Batch\n#name Same\nstep\n.xp 1\n"]);
  });

  it("asks for no choice for guides without a #name", async () => {
    const { dialog } = await importText("#group G\nstep\n\0#group G\nstep\n", {
      guides: [{ id: "u", order: 0, text: "#group G\nstep\n" }],
    });
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Import 2 guides" })).toHaveProperty("disabled", false);
  });

  it("marks a guide named like a built-in in its RegisterGuide group, and leaves it unchecked", async () => {
    const builtins = {
      version: "v1",
      guides: [{ id: "rxp:a", order: 0, text: "#group Shown\n#name A\nstep\n", registerArgs: { group: "Real" } }],
    };
    const { dialog } = await importText("#group Real\n#name A\nstep\n\0#group Shown\n#name A\nstep\n", { guides: [] }, builtins);
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["ARealBuilt in", "AShownNew"]);
    expect(rows.map((row) => within(row).getByRole<HTMLInputElement>("checkbox").checked)).toEqual([false, true]);
    expect(within(dialog).getByRole("button", { name: "Import 1 guide" })).toBeTruthy();
  });

  it("reads the files in order, and a file added during a read waits its turn", async () => {
    const first = slowFile("#group G\n#name First\nstep\n", "first.txt");
    const { dialog, user } = openDialog([first.file], { guides: [] });
    await user.upload(within(dialog).getByLabelText("Import files"), batch(1));
    expect(within(dialog).getByText("Reading first.txt…")).toBeTruthy();
    first.arrive();
    await within(dialog).findByText("Found 2 guides in 2 files.");
    expect(rowText(dialog)).toEqual(["FirstGNew", "SameBatchNew"]);
  });

  it("shows no status until a source is added", async () => {
    const { dialog, user } = openDialog([], { guides: [] });
    const status = dialog.querySelector("[aria-live]")!;
    expect(status.textContent).toBe("");
    await user.type(within(dialog).getByLabelText("Guide text"), "#group G{Enter}#name P{Enter}step");
    await user.click(within(dialog).getByRole("button", { name: "Add text" }));
    await within(dialog).findByText("Found 1 guide in 1 pasted text.");
    expect(status.textContent).toBe("Found 1 guide in 1 pasted text.");
  });

  it("closes its reader when it closes", async () => {
    const late = slowFile("#group G\n#name Late\nstep\n", "late.txt");
    const { reader, dialog, user } = openDialog([late.file], { guides: [] });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    late.arrive();
    reader.add([batch(1)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reader.getState()).toMatchObject({ sources: [late.file], done: 0, found: [] });
  });

  it("reports a file with no guides and reads the next", async () => {
    const empty = new File([""], "empty.txt", { type: "text/plain" });
    const { dialog } = await importFiles([empty, batch(1)], { guides: [] });
    within(dialog).getByText("Found 1 guide in 2 files.");
    expect(within(dialog).getByRole("alert").textContent).toBe("empty.txt: No guides found.");
    expect(rowText(dialog)).toEqual(["SameBatchNew"]);
  });

  it("imports the exact text of Lua, plain text, and zip guides, and writes nothing before submit", async () => {
    const lua = new File(['RXPGuides.RegisterGuide("L", [[\n#name Lua\nstep\n    .xp 2 -- kept\n]])\n'], "guides.lua");
    const plain = new File(["#group P\r\n#name Plain\r\nstep\r\n  .unknown  x\r\n"], "plain.txt", { type: "text/plain" });
    const zipped = createZip([
      { path: "Z/guides.lua", data: new TextEncoder().encode("RXPGuides.RegisterGuide([[#group Z\n#name Zip\nstep]])") },
    ]);
    const zip = new File([zipped], "Z.zip", { type: "application/zip" });
    const { store, dialog, user } = await importFiles([lua, plain, zip], { guides: [] });
    expect(store.getState().guides.size).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: "Import 3 guides" }));
    expect(texts(store)).toEqual([
      "#name Lua\nstep\n    .xp 2 -- kept\n",
      "#group P\r\n#name Plain\r\nstep\r\n  .unknown  x\r\n",
      "#group Z\n#name Zip\nstep",
    ]);
  });

  const same = (xp?: number) => `#group Batch\n#name Same\nstep\n${xp === undefined ? "" : `.xp ${xp}\n`}`;
  it.each([
    ["Replace all", [["stored", same(2)]]],
    [
      "Keep both for all",
      [
        ["stored", same()],
        ["new", same(1)],
        ["new", same(2)],
      ],
    ],
  ])("follows a clash with a stored guide and then an earlier entry with %s", async (choice, expected) => {
    const { store, dialog, user } = await importFiles([batch(1), batch(2)], { guides: [{ id: "stored", order: 0, text: same() }] });
    within(dialog).getByRole("group", { name: "Name taken in your guides:" });
    within(dialog).getByRole("group", { name: "Name taken in this import:" });
    await user.click(within(dialog).getByRole("button", { name: choice }));
    await user.click(within(dialog).getByRole("button", { name: "Import 2 guides" }));
    expect([...store.getState().guides].map(([id, g]) => [id === "stored" ? id : "new", g.text])).toEqual(expected);
  });
});
