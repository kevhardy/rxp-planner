// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmDialog, Dialog, PromptDialog } from "./Dialog.tsx";

afterEach(cleanup);

function Stack() {
  const [open, setOpen] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(1)}>
        Open
      </button>
      {open > 0 && (
        <Dialog title="First" onClose={() => setOpen(0)}>
          <p>Some text to select</p>
          <button type="button" onClick={() => setOpen(2)}>
            Open second
          </button>
          {open > 1 && (
            <Dialog title="Second" onClose={() => setOpen(1)}>
              <p>More text</p>
            </Dialog>
          )}
        </Dialog>
      )}
    </>
  );
}

function NewGroup() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New group
      </button>
      {open && (
        <PromptDialog title="New group" label="Group name" submitLabel="Create" onSubmit={() => null} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const backdrops = () => [...document.querySelectorAll("dialog")];
const dialogNames = () => screen.queryAllByRole("dialog").map((d) => d.querySelector("h2")!.textContent);

describe("Dialog", () => {
  it("closes with the X and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Stack />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "First" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialogNames()).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a click on the backdrop, which does not move focus", async () => {
    const user = userEvent.setup();
    render(<Stack />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const [backdrop] = backdrops();
    expect(fireEvent.mouseDown(backdrop!)).toBe(false);
    fireEvent.mouseUp(backdrop!);
    fireEvent.click(backdrop!);
    expect(dialogNames()).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it("stays open when a press inside the dialog ends on the backdrop", async () => {
    const user = userEvent.setup();
    render(<Stack />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const [backdrop] = backdrops();
    // A browser sends the click to the nearest element that holds both the press and the release.
    fireEvent.mouseDown(screen.getByText("Some text to select"));
    fireEvent.mouseUp(backdrop!);
    fireEvent.click(backdrop!);
    expect(dialogNames()).toEqual(["First"]);
  });

  it("closes only the top dialog of a stack", async () => {
    const user = userEvent.setup();
    render(<Stack />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const second = screen.getByRole("button", { name: "Open second" });
    await user.click(second);
    expect(dialogNames()).toEqual(["First", "Second"]);
    const top = backdrops().at(-1)!;
    fireEvent.mouseDown(top);
    fireEvent.mouseUp(top);
    fireEvent.click(top);
    expect(dialogNames()).toEqual(["First"]);
    expect(document.activeElement).toBe(second);
  });

  it("closes with Escape from anywhere and focuses the field first", async () => {
    const user = userEvent.setup();
    render(<NewGroup />);
    const opener = screen.getByRole("button", { name: "New group" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "New group" });
    const name = within(dialog).getByLabelText("Group name");
    expect(document.activeElement).toBe(name);

    name.blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(dialogNames()).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it("focuses the [data-autofocus] element before an earlier field", () => {
    render(
      <Dialog title="Rename" onClose={() => {}}>
        <input aria-label="Name" />
        <button type="button" data-autofocus>
          Keep
        </button>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
  });

  it("renders a description inside its dialog, so the modal layer does not cover it", () => {
    render(
      <Dialog title="Rename" onClose={() => {}}>
        <p>Text</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(within(dialog).getByRole("tooltip", { hidden: true }).textContent).toBe("Close (Escape)");
  });

  it("focuses the X first in a confirm dialog, not the confirm button", () => {
    render(
      <ConfirmDialog
        title="Delete guide?"
        message="It leaves this browser."
        confirmLabel="Delete"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete guide?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Close", "Delete"]);
  });
});
