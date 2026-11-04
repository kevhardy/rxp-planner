// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import { useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { ROOT } from "../theme/testing.ts";
import { Button, IconButton } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { Checkbox, Radio } from "./Checkbox.tsx";
import { Field, Input, Select } from "./Field.tsx";
import { ArtButton, ItemButton, MarkButton } from "./ItemButton.tsx";
import { MenuItem } from "./MenuItem.tsx";
import { Segmented } from "./Segmented.tsx";
import { Tab } from "./Tab.tsx";
import { cascade, type Look } from "./testing.ts";

afterEach(cleanup);

describe("Button", () => {
  it("does not submit its form unless it is a submit button", async () => {
    const submit = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary" type="submit">
          Save
        </Button>
      </form>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("IconButton", () => {
  it("is named by its label and describes its key in the tooltip", async () => {
    render(<IconButton icon="x" label="Close" description="Close (Escape)" />);
    const user = userEvent.setup();
    await user.hover(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Close (Escape)");
  });

  it("hides its tooltip while the popover it opened is open", async () => {
    render(<IconButton icon="plus" label="Add step" popoverOpen />);
    const user = userEvent.setup();
    await user.hover(screen.getByRole("button", { name: "Add step" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps its tooltip while the content it shows in place is open", async () => {
    render(<IconButton icon="chevronDown" label="Steps 4-6" description="Fold the steps (Left)" expanded />);
    const user = userEvent.setup();
    await user.hover(screen.getByRole("button", { name: "Steps 4-6" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Fold the steps (Left)");
  });
});

describe("Segmented", () => {
  function Mode() {
    const [mode, setMode] = useState<"edit" | "playback">("edit");
    return (
      <Segmented
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "edit", label: "Edit" },
          { value: "playback", label: "Playback" },
        ]}
      />
    );
  }

  it("presses the segment that the user chose and releases the other", async () => {
    render(<Mode />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Playback" }));
    const group = screen.getByRole("group", { name: "Mode" });
    const pressed = [...group.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(pressed).toEqual([
      ["Edit", "false"],
      ["Playback", "true"],
    ]);
  });
});

describe("MenuItem", () => {
  it("is a check item or a radio item when it has a checked state", () => {
    render(
      <div role="menu">
        <MenuItem>Import guide</MenuItem>
        <MenuItem checked>Show names</MenuItem>
        <MenuItem checked={false} radio>
          Upcoming
        </MenuItem>
      </div>,
    );
    expect(screen.getByRole("menuitem", { name: "Import guide" }).tabIndex).toBe(-1);
    expect(screen.getByRole("menuitemcheckbox", { name: "Show names" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Upcoming" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("Tab", () => {
  it("keeps only the selected tab in the tab order", () => {
    render(
      <div role="tablist">
        <Tab selected controls="panel">
          Lines
        </Tab>
        <Tab selected={false} controls="panel">
          Raw
        </Tab>
      </div>,
    );
    expect(screen.getAllByRole("tab").map((t) => [t.textContent, t.tabIndex])).toEqual([
      ["Lines", 0],
      ["Raw", -1],
    ]);
  });
});

describe("MarkButton", () => {
  it("sits at its place in percent of the map view", () => {
    render(<MarkButton label="Step 6" at={{ x: 12.5, y: 40 }} vars={{ "--fade": 0.5 }} />);
    const mark = screen.getByRole("button", { name: "Step 6" });
    expect([mark.style.getPropertyValue("--at-x"), mark.style.getPropertyValue("--at-y"), mark.style.getPropertyValue("--fade")]).toEqual([
      "12.5%",
      "40%",
      "0.5",
    ]);
  });

  it("fails when a spread props object passes vars a key that is not a custom property", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const markProps = { vars: { "--fade": 0.5, left: "10%" } };
    expect(() => render(<MarkButton label="Step 6" {...markProps} />)).toThrow("so it cannot set `left`");
    vi.restoreAllMocks();
  });
});

describe("each primitive", () => {
  const named = (name: string) =>
    [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name)!;

  function gallery() {
    render(
      <div id="caller">
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="secondary" size={28}>
          Field height
        </Button>
        <Button variant="secondary" size={32}>
          Large
        </Button>
        <Button variant="secondary" wrap>
          Wrap
        </Button>
        <Button variant="ghost" pressed>
          Pressed
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="ghost" disabled>
          Disabled ghost
        </Button>
        <IconButton icon="x" label="Icon" />
        <IconButton icon="x" label="Field height icon" size={28} />
        <IconButton icon="x" label="Large icon" size={32} />
        <IconButton icon="plus" label="Open" popoverOpen />
        <IconButton icon="plus" label="Open primary" variant="primary" popoverOpen />
        <IconButton icon="plus" label="Closed primary" variant="primary" popoverOpen={false} />
        <Segmented
          label="Mode"
          value="on"
          options={[
            { value: "off", label: "Segment" },
            { value: "on", label: "On segment" },
          ]}
          onChange={() => {}}
        />
        <Segmented label="Size" size={32} value={null} options={[{ value: "a", label: "Large segment" }]} onChange={() => {}} />
        <MenuItem>Menu item</MenuItem>
        <MenuItem disabled>Disabled menu item</MenuItem>
        <Tab selected={false} controls="p">
          Tab
        </Tab>
        <Tab selected controls="p">
          Selected tab
        </Tab>
        <Tab selected={false} controls="p" size={32}>
          Large tab
        </Tab>
        <Tab selected controls="p" disabled>
          Disabled selected tab
        </Tab>
        <ItemButton>Item</ItemButton>
        <ItemButton aria-current="page">Current item</ItemButton>
        <ItemButton chosen>Chosen item</ItemButton>
        <ItemButton objective="var(--objective-2)">Objective item</ItemButton>
        <ItemButton objective="var(--objective-3)" aria-current="true">
          Current objective item
        </ItemButton>
        <ItemButton disabled>Disabled item</ItemButton>
        <ArtButton>Art</ArtButton>
      </div>,
    );
  }

  const LOOKS = {
    rest: {},
    hover: { states: ["hover"] },
    press: { states: ["hover", "active"] },
    focus: { states: ["focus-visible"] },
    "::after": { pseudo: "after" },
  } satisfies Record<string, Look>;

  const small = "var(--control-small)";
  const large = "var(--control-large)";
  const grown = "min(0px, (100% - var(--control-small)) / 2)";
  const ROWS: Array<[name: string, look: keyof typeof LOOKS, property: string, value: string]> = [
    ["Secondary", "rest", "height", small],
    ["Secondary", "rest", "min-width", small],
    ["Field height", "rest", "height", "var(--control-field)"],
    ["Large", "rest", "height", large],
    ["Wrap", "rest", "height", "auto"],
    ["Wrap", "rest", "min-height", small],
    ["Icon", "rest", "width", small],
    ["Field height icon", "rest", "width", "var(--control-field)"],
    ["Large icon", "rest", "width", large],
    ["Segment", "rest", "height", small],
    ["Segment", "rest", "min-width", small],
    ["Large segment", "rest", "height", large],
    ["Menu item", "rest", "min-height", large],
    ["Menu item", "rest", "min-width", small],
    ["Tab", "rest", "height", small],
    ["Tab", "rest", "min-width", small],
    ["Large tab", "rest", "height", large],
    ["Item", "::after", "content", '""'],
    ["Item", "::after", "position", "absolute"],
    ["Item", "::after", "inset", grown],
    ["Art", "::after", "content", '""'],
    ["Art", "::after", "position", "absolute"],
    ["Art", "::after", "inset", grown],

    ["Secondary", "focus", "outline", "var(--focus-ring)"],
    ["Segment", "focus", "outline", "var(--focus-ring)"],
    ["Menu item", "focus", "outline", "var(--focus-ring)"],
    ["Tab", "focus", "outline", "var(--focus-ring)"],
    ["Item", "focus", "outline", "var(--focus-ring)"],
    ["Art", "focus", "outline", "var(--focus-ring)"],

    ["Primary", "hover", "background", "var(--primary-hover)"],
    ["Primary", "press", "background", "var(--primary-press)"],
    ["Secondary", "hover", "border-color", "var(--control-border)"],
    ["Secondary", "hover", "background", "var(--hover)"],
    ["Secondary", "hover", "color", "var(--text)"],
    ["Secondary", "press", "background", "var(--press)"],
    ["Ghost", "hover", "background", "var(--hover)"],
    ["Ghost", "press", "background", "var(--press)"],
    ["Danger", "hover", "background", "var(--danger-hover)"],
    ["Danger", "press", "background", "var(--danger-press)"],
    ["Pressed", "rest", "border-color", "var(--accent)"],
    ["Pressed", "rest", "box-shadow", "var(--ring-pressed)"],
    ["Pressed", "press", "background", "var(--press)"],
    ["Pressed", "rest", "color", "var(--text)"],
    ["Open", "rest", "border-color", "var(--accent)"],
    ["Open", "rest", "box-shadow", "var(--ring-pressed)"],
    ["Open", "rest", "color", "var(--text)"],
    ["Open", "press", "background", "var(--press)"],
    ["Open primary", "rest", "box-shadow", "var(--ring-pressed)"],
    ["Open primary", "rest", "background", "var(--raised)"],
    ["Open primary", "hover", "background", "var(--raised)"],
    ["Open primary", "press", "background", "var(--press)"],
    ["Closed primary", "press", "background", "var(--primary-press)"],
    ["Disabled", "rest", "border-color", "var(--disabled-fg)"],
    ["Disabled", "hover", "background", "none"],
    ["Disabled", "rest", "box-shadow", "none"],
    ["Disabled", "rest", "color", "var(--disabled-fg)"],
    ["Disabled", "rest", "font-weight", "var(--font-weight-regular)"],
    ["Disabled", "rest", "opacity", "1"],
    ["Disabled", "rest", "filter", "none"],
    ["Disabled ghost", "hover", "border-color", "transparent"],
    ["Disabled ghost", "rest", "color", "var(--disabled-fg)"],
    ["Disabled ghost", "rest", "opacity", "1"],
    ["Disabled ghost", "rest", "filter", "none"],

    ["Segment", "hover", "background", "var(--hover)"],
    ["Segment", "hover", "color", "var(--text)"],
    ["Segment", "press", "background", "var(--press)"],
    ["On segment", "rest", "background", "var(--selection)"],
    ["On segment", "press", "background", "var(--press)"],
    ["On segment", "rest", "border-block-end-color", "var(--pop)"],
    ["On segment", "rest", "border-end-start-radius", "0"],
    ["On segment", "rest", "border-end-end-radius", "0"],
    ["On segment", "rest", "box-shadow", "var(--ink-bar-bottom)"],
    ["On segment", "rest", "color", "var(--text)"],
    ["On segment", "rest", "font-weight", "var(--font-weight-bold)"],

    ["Menu item", "hover", "background", "var(--hover)"],
    ["Menu item", "focus", "background", "var(--hover)"],
    ["Menu item", "press", "background", "var(--press)"],
    ["Disabled menu item", "hover", "background", "none"],
    ["Disabled menu item", "rest", "color", "var(--disabled-fg)"],
    ["Disabled menu item", "rest", "opacity", "1"],
    ["Disabled menu item", "rest", "filter", "none"],

    ["Tab", "hover", "background", "var(--hover)"],
    ["Tab", "hover", "color", "var(--text)"],
    ["Tab", "press", "background", "var(--press)"],
    ["Selected tab", "rest", "background", "var(--selection)"],
    ["Selected tab", "press", "background", "var(--press)"],
    ["Selected tab", "rest", "box-shadow", "var(--ink-bar-bottom)"],
    ["Selected tab", "rest", "color", "var(--text)"],
    ["Selected tab", "rest", "font-weight", "var(--font-weight-bold)"],
    ["Disabled selected tab", "rest", "background", "none"],
    ["Disabled selected tab", "rest", "box-shadow", "none"],
    ["Disabled selected tab", "rest", "color", "var(--disabled-fg)"],
    ["Disabled selected tab", "rest", "opacity", "1"],
    ["Disabled selected tab", "rest", "filter", "none"],

    ["Item", "hover", "background", "var(--hover)"],
    ["Item", "press", "background", "var(--press)"],
    ["Current item", "rest", "background", "var(--selection)"],
    ["Current item", "press", "background", "var(--press)"],
    ["Current item", "rest", "border-start-start-radius", "0"],
    ["Current item", "rest", "border-end-start-radius", "0"],
    ["Current item", "rest", "box-shadow", "var(--ink-bar-start)"],
    ["Chosen item", "rest", "background", "var(--selection)"],
    ["Chosen item", "press", "background", "var(--press)"],
    ["Chosen item", "rest", "box-shadow", "var(--ink-bar-start)"],
    ["Objective item", "rest", "box-shadow", "var(--ink-bar-objective)"],
    ["Objective item", "hover", "background", "var(--objective-tint)"],
    ["Objective item", "focus", "background", "var(--objective-tint)"],
    ["Objective item", "press", "background", "var(--press)"],
    ["Current objective item", "rest", "box-shadow", "var(--ink-bar-start), var(--ink-bar-objective)"],
    ["Current objective item", "hover", "background", "var(--selection)"],
    ["Disabled item", "hover", "background", "none"],
    ["Disabled item", "rest", "box-shadow", "none"],
    ["Disabled item", "rest", "color", "var(--disabled-fg)"],
    ["Disabled item", "rest", "opacity", "1"],
    ["Disabled item", "rest", "filter", "none"],
  ];

  const owned = (name: string, look: keyof typeof LOOKS, property: string) =>
    cascade(named(name), property, { ...LOOKS[look], caller: `#caller *, #caller *::after { ${property}: caller; }` });

  it.each(ROWS)("%s, %s: keeps %s at %s over a caller's rule", (name, look, property, value) => {
    gallery();
    expect(owned(name, look, property)?.value).toBe(value);
  });

  it("has a row for each important declaration in ui.css", () => {
    const sheet = "src/app/ui/ui.css";
    const important: string[] = [];
    postcss.parse(readFileSync(join(ROOT, sheet), "utf8")).walkDecls((decl) => {
      if (decl.important) important.push(`${sheet}:${decl.source?.start?.line}`);
    });
    gallery();
    const winners = new Set(ROWS.map(([name, look, property]) => owned(name, look, property)?.from));
    expect(winners).toEqual(new Set(important));
  });

  it("positions each item and art, so its ::after hit area sizes on the button and not on a pane", () => {
    gallery();
    expect(["Item", "Art"].map((name) => cascade(named(name), "position")?.value)).toEqual(["relative", "relative"]);
  });

  it("rings focused art with no filter, so the XP ring and the warning mark stay readable", () => {
    render(
      <>
        <ArtButton className="sim-ring">5</ArtButton>
        <ArtButton className="step-warn-badge" aria-label="3 warnings">
          !
        </ArtButton>
      </>,
    );
    const focused = (name: string) =>
      ["outline", "filter"].map((property) => cascade(named(name), property, { states: ["focus-visible"] })?.value);
    expect([focused("5"), focused("3 warnings")]).toEqual([
      ["var(--focus-ring)", undefined],
      ["var(--focus-ring)", undefined],
    ]);
  });

  it("sets its state only from its own props", () => {
    render(
      <>
        <Button variant="ghost" pressed>
          Routes
        </Button>
        <IconButton icon="eye" label="Quests" pressed="mixed" />
        <ItemButton pressed={false}>Available</ItemButton>
        <ItemButton chosen>Leg 1</ItemButton>
        <MarkButton label="Step 6" at={{ x: 0, y: 0 }} pressed />
        <MarkButton label="Mill" popoverOpen />
        <IconButton icon="plus" label="Add step" popoverOpen />
        <IconButton icon="x" label="Close" />
      </>,
    );
    expect(
      ["Routes", "Quests", "Available", "Leg 1", "Step 6", "Mill", "Add step", "Close"].map((name) =>
        ["aria-pressed", "aria-expanded"].map((state) => named(name).getAttribute(state)),
      ),
    ).toEqual([
      ["true", null],
      ["mixed", null],
      ["false", null],
      ["true", null],
      ["true", null],
      [null, "true"],
      [null, "true"],
      [null, null],
    ]);
  });
});

describe("Field", () => {
  it("names its control by the label and describes it by the hint and the error", () => {
    render(
      <Field label="Zone" hint="Elwynn Forest" error="Unknown zone">
        <Input value="Elwyn" readOnly />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Zone" });
    expect([input.getAttribute("aria-invalid"), (input as HTMLInputElement).labels?.[0]?.textContent]).toEqual(["true", "Zone"]);
    const described = input
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Elwynn Forest", "Unknown zone"]);
  });

  it("keeps a description that the control sets for itself", () => {
    render(
      <>
        <p id="note">Levels 1 to 60</p>
        <Field label="Level">
          <Select aria-describedby="note" value="1" onChange={() => {}}>
            <option value="1">1</option>
          </Select>
        </Field>
      </>,
    );
    const select = screen.getByRole("combobox", { name: "Level" });
    expect([select.getAttribute("aria-describedby"), select.getAttribute("aria-invalid")]).toEqual(["note", null]);
  });
});

describe("Checkbox", () => {
  it("toggles from a click on its label text", async () => {
    function Optional() {
      const [on, setOn] = useState(false);
      return <Checkbox label="Optional" checked={on} onChange={(e) => setOn(e.target.checked)} />;
    }
    render(<Optional />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Optional"));
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Optional" }).checked).toBe(true);
  });

  it("shows a group that is partly checked as mixed", () => {
    render(<Checkbox aria-label="Import all" checked={false} indeterminate onChange={() => {}} />);
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: "Import all" });
    expect([box.indeterminate, cascade(box.nextElementSibling!, "visibility")?.value]).toEqual([true, "visible"]);
  });

  it("keeps the disabled border while it is checked", () => {
    render(<Checkbox aria-label="Hidden" checked disabled onChange={() => {}} />);
    expect(cascade(screen.getByRole("checkbox", { name: "Hidden" }), "border-color")?.value).toBe("var(--disabled-fg)");
  });
});

describe("Radio", () => {
  it("shows no dot while no radio in its group is checked", () => {
    render(
      <>
        <Radio name="conflict" label="Replace" checked={false} onChange={() => {}} />
        <Radio name="conflict" label="Keep both" checked={false} onChange={() => {}} />
        <Radio name="level" label="Ground" checked onChange={() => {}} />
      </>,
    );
    const dot = (name: string) => cascade(screen.getByRole("radio", { name }).nextElementSibling!, "visibility")?.value;
    expect(["Replace", "Keep both", "Ground"].map(dot)).toEqual(["hidden", "hidden", "visible"]);
  });
});

describe("Card", () => {
  it("fails when it sits inside another card", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <Card>
          <Card>Legend</Card>
        </Card>,
      ),
    ).toThrow("A Card cannot sit inside a Card");
    vi.restoreAllMocks();
  });

  it("renders a nested card in a production build", () => {
    vi.stubEnv("DEV", false);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    render(
      <Card aria-label="Map">
        <Card aria-label="Legend" />
      </Card>,
    );
    expect(screen.getByLabelText("Legend").parentElement).toBe(screen.getByLabelText("Map"));
  });

  it("fails when a spread props object passes vars a key that is not a custom property", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const place = { x: "12px" };
    const cardProps = { vars: { "--at-x": place.x, top: "10px", "--control-small": "100px" } };
    expect(() => render(<Card {...cardProps}>Panel</Card>)).toThrow("so it cannot set `top`");
    vi.restoreAllMocks();
  });

  it("fails when vars sets a token", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cardProps = { vars: { "--control-small": "100px" } };
    expect(() => render(<Card {...cardProps}>Panel</Card>)).toThrow("so it cannot set `--control-small`");
    vi.restoreAllMocks();
  });

  it("drops a vars key that is not a custom property in a production build", () => {
    vi.stubEnv("DEV", false);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const cardProps = { vars: { "--at-x": "12px", top: "10px" } };
    render(<Card aria-label="Panel" {...cardProps} />);
    const card = screen.getByLabelText("Panel");
    expect([card.style.getPropertyValue("--at-x"), card.style.top]).toEqual(["12px", ""]);
  });

  it("lets a popover open from inside a card", () => {
    render(
      <Card aria-label="Editor">
        <Card layer role="dialog" aria-label="Add line" />
      </Card>,
    );
    expect(screen.getByRole("dialog", { name: "Add line" }).closest(".ui-card .ui-card")).not.toBeNull();
  });
});
