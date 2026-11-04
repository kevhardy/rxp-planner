// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCondition } from "../guide/index.ts";
import { ConditionEditor, DraftField } from "./fields.tsx";
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
});
