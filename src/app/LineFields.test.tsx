// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setText, updateLine, type TextLine } from "../guide/index.ts";
import { StoresContext } from "./context.ts";
import { editSection } from "./drafts.ts";
import { EditorDock } from "./EditorDock.tsx";
import { createStores } from "./stores.ts";
import { selectText } from "./testing.ts";

afterEach(cleanup);

const OPENED = "Opened your copy in “G (custom)”. Make the change there.";

function mountBuiltinWithCopy() {
  const text = "#group G\n#name A\nstep\n>>Hello\n";
  const builtins = { version: "v1", guides: [{ id: "rxp:a", text, order: 0 }] };
  const library = { guides: [], session: { guideId: "rxp:a", step: 0, line: 0 } };
  const stores = createStores(library, builtins);
  render(
    <StoresContext.Provider value={stores}>
      <EditorDock />
    </StoresContext.Provider>,
  );
  const store = stores.editor;
  act(() => void editSection(store, 0, (d) => updateLine(d, { step: 0, index: 0 }, (l) => setText(l as TextLine, "Copy")), undefined, 0));
  act(() => store.open("rxp:a"));
  return { store, user: userEvent.setup() };
}

describe("line errors", () => {
  it("clears a text kind error when a later text commit succeeds", async () => {
    const { store, user } = mountBuiltinWithCopy();
    await user.click(screen.getByRole("tab", { name: "Lines" }));
    const line = () => screen.getByRole("group", { name: /^Line 1,/ });
    await user.selectOptions(within(line()).getByRole("combobox", { name: "Text kind" }), "+");
    expect(within(line()).getByRole("alert").textContent).toBe(OPENED);

    selectText(within(line()).getByLabelText("Text"), "Copy".length);
    await user.keyboard("X{Enter}");
    expect(store.getState().current!.doc.steps[0]!.body[0]).toMatchObject({ kind: "text", text: "CopyX" });
    expect(within(line()).queryByRole("alert")).toBeNull();
  });
});
