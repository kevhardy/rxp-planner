import type { ButtonHTMLAttributes, ComponentProps, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Button, IconButton } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { Checkbox, Radio } from "./Checkbox.tsx";
import { FileInput, Input, Select, Slider, TextArea } from "./Field.tsx";
import { ArtButton, ItemButton, MarkButton } from "./ItemButton.tsx";
import { MenuItem } from "./MenuItem.tsx";
import { Segmented } from "./Segmented.tsx";
import { Stack } from "./Stack.tsx";
import { Tab } from "./Tab.tsx";
import type { Heading } from "./Text.tsx";

type ButtonProps = ComponentProps<typeof Button>;
type IconButtonProps = ComponentProps<typeof IconButton>;
type ItemProps = ComponentProps<typeof ItemButton>;
type MarkProps = ComponentProps<typeof MarkButton>;

export const ok: [ButtonProps, IconButtonProps, MarkProps] = [
  { variant: "primary", size: 32, children: "Export" },
  { icon: "x", label: "Close" },
  { label: "Step 6", at: { x: 10, y: 20 }, vars: { "--fade": 0.5 } },
];

export const toggles: [ButtonProps, IconButtonProps, IconButtonProps, ItemProps, ItemProps] = [
  { variant: "ghost", pressed: true, children: "Routes" },
  { icon: "eye", label: "Quests", pressed: "mixed" },
  { icon: "moon", label: "Dark mode", pressed: false, iconShowsPressed: true },
  { pressed: true, children: "Available" },
  { chosen: true, children: "Leg 1" },
];

// @ts-expect-error An icon-only button needs a label, its accessible name.
export const noLabel: IconButtonProps = { icon: "x" };
// @ts-expect-error A button picks one of the variants.
export const noVariant: ButtonProps = { children: "Save" };
// @ts-expect-error A button picks one of the variants.
export const unknownVariant: ButtonProps = { variant: "link", children: "Save" };
// @ts-expect-error A button is 24px, 28px, or 32px tall.
export const oddSize: ButtonProps = { variant: "ghost", size: 30, children: "Save" };
// @ts-expect-error A primitive takes no inline style.
export const styled: ButtonProps = { variant: "ghost", style: { margin: 0 }, children: "Save" };
// @ts-expect-error The label is the accessible name, so there is no second one.
export const twoNames: IconButtonProps = { icon: "x", label: "Close", "aria-label": "Dismiss" };
// @ts-expect-error An icon-only button is never the danger fill.
export const dangerIcon: IconButtonProps = { icon: "trash", label: "Delete", variant: "danger" };
// @ts-expect-error A mark's custom properties are custom properties.
export const markStyle: MarkProps = { label: "Step 6", at: { x: 10, y: 20 }, vars: { left: "10%" } };
// @ts-expect-error A toggle sets `pressed`, so the primitive picks its look.
export const rawPressed: ButtonProps = { variant: "ghost", "aria-pressed": true, children: "Routes" };
// @ts-expect-error A primary or danger button is an action, never a toggle.
export const primaryToggle: ButtonProps = { variant: "primary", pressed: true, children: "Export" };
// @ts-expect-error Only a toggle has a state for its icon to show.
export const iconStateWithoutToggle: IconButtonProps = { icon: "moon", label: "Dark mode", iconShowsPressed: true };
// @ts-expect-error A trigger sets `popoverOpen` and a disclosure sets `expanded`, so only a trigger shows the open look.
export const rawExpanded: ButtonProps = { variant: "ghost", "aria-expanded": true, children: "Character" };
// @ts-expect-error A trigger sets `popoverOpen` and a disclosure sets `expanded`, so only a trigger shows the open look.
export const rawIconExpanded: IconButtonProps = { icon: "plus", label: "Add step", "aria-expanded": true };
// @ts-expect-error A control opens a popover or shows content in place, not both.
export const openAndExpanded: IconButtonProps = { icon: "plus", label: "Add step", popoverOpen: true, expanded: true };
// @ts-expect-error An item is a toggle or the chosen item of its list, not both.
export const toggleAndChoice: ItemProps = { pressed: true, chosen: true, children: "Leg 1" };
// @ts-expect-error An item sets `pressed` or `chosen`, so the primitive picks its look.
export const rawItemPressed: ItemProps = { "aria-pressed": true, children: "Leg 1" };

// JSX checks a spread and a hyphenated attribute only against a prop that the type declares.
const style = { style: { height: 100 } };
const pressed = { "aria-pressed": true } as const;
const at = { x: 0, y: 0 };
const one = [{ value: "a", label: "A" }] as const;
const noop = () => {};

export const spreadStyle = [
  // @ts-expect-error A spread passes no inline style.
  <Button key="a" variant="ghost" {...style}>
    Go
  </Button>,
  // @ts-expect-error A spread passes no inline style.
  <IconButton key="b" icon="x" label="Close" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <ItemButton key="c" {...style}>
    Item
  </ItemButton>,
  // @ts-expect-error A spread passes no inline style.
  <ArtButton key="d" {...style}>
    Art
  </ArtButton>,
  // @ts-expect-error A spread passes no inline style.
  <MarkButton key="e" label="Mark" at={at} {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <MenuItem key="f" {...style}>
    Menu
  </MenuItem>,
  // @ts-expect-error A spread passes no inline style.
  <Tab key="g" selected controls="p" {...style}>
    Tab
  </Tab>,
  // @ts-expect-error A spread passes no inline style.
  <Segmented key="h" label="G" value="a" options={one} onChange={noop} {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Input key="i" aria-label="X" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Select key="j" aria-label="Map" {...style}>
    <option>A</option>
  </Select>,
  // @ts-expect-error A spread passes no inline style.
  <TextArea key="k" aria-label="Guide text" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Checkbox key="l" label="Optional" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Radio key="m" name="g" label="Replace" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Slider key="n" aria-label="Speed" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <FileInput key="o" {...style} />,
  // @ts-expect-error A spread passes no inline style.
  <Stack key="p" gap={2} {...style}>
    Row
  </Stack>,
  // @ts-expect-error A spread passes no inline style.
  <Card key="q" {...style}>
    Panel
  </Card>,
];

export const rawPressedJsx = [
  // @ts-expect-error A toggle sets `pressed`, so the primitive picks its look.
  <Button key="a" variant="ghost" aria-pressed>
    Go
  </Button>,
  // @ts-expect-error A toggle sets `pressed`.
  <IconButton key="b" icon="x" label="Close" aria-pressed />,
  // @ts-expect-error A toggle sets `pressed`.
  <ItemButton key="c" aria-pressed>
    Item
  </ItemButton>,
  // @ts-expect-error Art is never a toggle.
  <ArtButton key="d" aria-pressed>
    Art
  </ArtButton>,
  // @ts-expect-error A toggle sets `pressed`.
  <MarkButton key="e" label="Mark" at={at} aria-pressed />,
  // @ts-expect-error A menu item sets `checked`.
  <MenuItem key="f" aria-pressed>
    Menu
  </MenuItem>,
  // @ts-expect-error A tab sets `selected`.
  <Tab key="g" selected controls="p" aria-pressed>
    Tab
  </Tab>,
  // @ts-expect-error The group presses the segment of `value`.
  <Segmented key="h" label="G" value="a" options={one} onChange={noop} aria-pressed />,
];

export const spreadPressed = [
  // @ts-expect-error A spread cannot set the state either.
  <Button key="a" variant="ghost" {...pressed}>
    Go
  </Button>,
  // @ts-expect-error A spread cannot set the state either.
  <IconButton key="b" icon="x" label="Close" {...pressed} />,
  // @ts-expect-error A spread cannot set the state either.
  <ItemButton key="c" {...pressed}>
    Item
  </ItemButton>,
  // @ts-expect-error A spread cannot set the state either.
  <ArtButton key="d" {...pressed}>
    Art
  </ArtButton>,
  // @ts-expect-error A spread cannot set the state either.
  <MarkButton key="e" label="Mark" at={at} {...pressed} />,
  // @ts-expect-error A spread cannot set the state either.
  <MenuItem key="f" {...pressed}>
    Menu
  </MenuItem>,
  // @ts-expect-error A spread cannot set the state either.
  <Tab key="g" selected controls="p" {...pressed}>
    Tab
  </Tab>,
  // @ts-expect-error A spread cannot set the state either.
  <Segmented key="h" label="G" value="a" options={one} onChange={noop} {...pressed} />,
];

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

export const wrappers = [
  (props: Native) => (
    // @ts-expect-error The native attributes hold a style.
    <Button {...props} type="button" variant="ghost">
      Go
    </Button>
  ),
  // @ts-expect-error The native attributes hold a style.
  (props: Native) => <IconButton {...props} icon="x" label="Close" />,
  // @ts-expect-error The native attributes hold a style.
  (props: Native) => <ItemButton {...props}>Item</ItemButton>,
  // @ts-expect-error The native attributes hold a style.
  (props: Native) => <ArtButton {...props}>Art</ArtButton>,
  // @ts-expect-error The native attributes hold a style.
  (props: Native) => <MarkButton {...props} label="Mark" at={at} />,
  // @ts-expect-error The native attributes hold a style.
  (props: Native) => <MenuItem {...props}>Menu</MenuItem>,
  (props: Native) => (
    // @ts-expect-error The native attributes hold a style.
    <Tab {...props} selected controls="p">
      Tab
    </Tab>
  ),
  // @ts-expect-error The native attributes hold a style.
  (props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">) => <Input {...props} />,
  (props: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">) => (
    // @ts-expect-error The native attributes hold a style.
    <Select {...props}>
      <option>A</option>
    </Select>
  ),
  // @ts-expect-error The native attributes hold a style.
  (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <TextArea {...props} />,
  // @ts-expect-error The native attributes hold a style.
  (props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">) => <Checkbox {...props} />,
];
type InputProps = ComponentProps<typeof Input>;
type HeadingProps = ComponentProps<typeof Heading>;
type StackProps = ComponentProps<typeof Stack>;
type CardProps = ComponentProps<typeof Card>;

export const fieldsOk: [InputProps, HeadingProps, StackProps, CardProps] = [
  { size: 32, mono: true, value: "44.9" },
  { level: 2, size: "pane-title", children: "Steps" },
  { direction: "column", gap: 2, children: null },
  { layer: true, vars: { "--popover-top": "8px" } },
];

// @ts-expect-error A field is 24px or 32px tall.
export const inputChars: InputProps = { size: 20 };
// @ts-expect-error A primitive takes no inline style.
export const inputStyle: InputProps = { style: { width: 80 } };
// @ts-expect-error A text box is not a check box; that is Checkbox.
export const inputCheck: InputProps = { type: "checkbox" };
// @ts-expect-error A heading size is a step of the type scale.
export const headingSize: HeadingProps = { level: 2, size: "large", children: "Steps" };
// @ts-expect-error A heading has a level in the outline.
export const headingLevel: HeadingProps = { size: "body", children: "Steps" };
// @ts-expect-error A gap is a step of the 4px grid.
export const oddGap: StackProps = { gap: 5, children: null };
// @ts-expect-error A card's custom properties are custom properties.
export const cardVars: CardProps = { vars: { top: "8px" } };
