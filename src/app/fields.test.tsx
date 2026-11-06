// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCondition } from "../guide/index.ts";
import { NO_DRAFT, readDraft, type DraftOwner, type DraftState } from "./drafts.ts";
import { ConditionEditor, DraftField, DraftScope } from "./fields.tsx";
import { cascade } from "./ui/testing.ts";

afterEach(cleanup);

describe("DraftField", () => {
  it("keeps a short input beside its label in a row, and fills the field when the input sits under its label", () => {
    render(
      <>
        <DraftField label="Count" draftName="Count" value="2" className="arg-short" onCommit={() => null} />
        <DraftField label="questId" draftName="questId" value="96627" className="arg-short" layout="stacked" onCommit={() => null} />
      </>,
    );
    expect(["Count", "questId"].map((name) => cascade(screen.getByLabelText(name), "min-width")?.value)).toEqual(["0", "100%"]);
  });

  it("keeps the draft while focus moves between the input and its tools, and commits once focus leaves both", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn((_text: string) => null);
    render(
      <>
        <DraftField label="Name" draftName="Name" value="Old" onCommit={onCommit} tools={() => <button type="button">Tool</button>} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.type(input, " name");
    await user.click(screen.getByRole("button", { name: "Tool" }));
    await user.click(input);
    expect(onCommit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onCommit.mock.calls).toEqual([["Old name"]]);
  });

  it("drops the draft before onCommit runs", async () => {
    const user = userEvent.setup();
    const owner: DraftOwner = { object: { unscoped: true }, guide: "guide" };
    const during: DraftState[] = [];
    render(
      <DraftScope.Provider value={owner}>
        <DraftField label="Name" draftName="Name" value="Old" onCommit={() => (during.push(readDraft(owner, "Name")), null)} />
      </DraftScope.Provider>,
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), " name{Enter}");
    expect([during, readDraft(owner, "Name")]).toEqual([[NO_DRAFT], NO_DRAFT]);
  });
});

describe("ConditionEditor", () => {
  it("commits the text of the rows that a token button changes", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn((_text: string | undefined) => null);
    render(<ConditionEditor label="Condition" draftName="condition" condition={parseCondition("Human Warrior/Orc")} onCommit={onCommit} />);

    await user.click(screen.getByRole("button", { name: "Negate Warrior" }));
    expect(onCommit).toHaveBeenLastCalledWith("Human !Warrior/Orc");
    await user.click(screen.getByRole("button", { name: "Remove Orc" }));
    expect(onCommit).toHaveBeenLastCalledWith("Human Warrior");
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("clears a token button's error when a later text commit succeeds", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn((text: string | undefined) => (text === "Human !Warrior/Orc" ? "Not allowed here" : null));
    render(<ConditionEditor label="Condition" draftName="condition" condition={parseCondition("Human Warrior/Orc")} onCommit={onCommit} />);

    await user.click(screen.getByRole("button", { name: "Negate Warrior" }));
    expect(screen.getByRole("alert").textContent).toBe("Not allowed here");
    await user.clear(screen.getByRole("textbox", { name: "Condition" }));
    await user.type(screen.getByRole("textbox", { name: "Condition" }), "Orc{Enter}");
    expect(onCommit).toHaveBeenLastCalledWith("Orc");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
