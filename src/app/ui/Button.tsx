import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Described } from "../Described.tsx";
import { Icon, type IconName } from "../icons.tsx";

/**
 * - `primary`: the one main action of a region.
 * - `secondary`: any other action.
 * - `ghost`: an action in a toolbar, or a quiet action.
 * - `danger`: an action that destroys work.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** The height in px: 24 in panes, popovers, and menus; 32 in the banner, in dialogs, and over the map. */
export type ControlSize = 24 | 32;

/** A button can also be 28, the height of the fields in a row beside it. */
export type ButtonSize = ControlSize | 28;

/**
 * The primitive owns its height, its 24px hit area, and its state looks, such
 * as hover, press, and focus, which win over any rule of the caller.
 * `className` sets the layout and the rest of the look, such as a fill, or the
 * border and corners where buttons join into one group.
 */
export type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "type" | "children" | "aria-pressed"> & {
  ref?: Ref<HTMLButtonElement>;
  style?: never;
  "aria-pressed"?: never;
};

/** `pressed` is the `aria-pressed` of a toggle, so `false` is an off toggle and `undefined` is no toggle. */
type Toggle = { variant: "primary" | "danger"; pressed?: never } | { variant: "secondary" | "ghost"; pressed?: boolean };

type Expands = { popoverOpen?: boolean; expanded?: never } | { expanded?: boolean; popoverOpen?: never };

/**
 * `popoverOpen` makes the button the trigger of a menu, a popover, or a
 * drawer: it is the trigger's `aria-expanded`, and the open trigger shows the
 * open look. `expanded` is the `aria-expanded` of a control that shows
 * content in place, such as a disclosure, which keeps its own look.
 */
export function Button(
  props: NativeButtonProps &
    Toggle &
    Expands & {
      "aria-expanded"?: never;
      size?: ButtonSize;
      type?: "button" | "submit";
      /** Lets a long label wrap, so the button grows taller than `size`. */
      wrap?: boolean;
      children: ReactNode;
    },
) {
  const { variant, pressed, popoverOpen, expanded, size = 24, type = "button", wrap, className, children, ...rest } = props;
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      aria-expanded={popoverOpen ?? expanded}
      data-popover={popoverOpen === undefined ? undefined : ""}
      className={className ? `ui-button ${className}` : "ui-button"}
      data-variant={variant}
      data-size={size}
      data-wrap={wrap || undefined}
    >
      {children}
    </button>
  );
}

/**
 * `label` is the accessible name, and the tooltip unless `description` says
 * more, such as a key. `popoverOpen` and `expanded` are as on `Button`, and
 * `popoverOpen` also hides the tooltip while the popover is open. `pin` lets a
 * click pin the tooltip open, for a description that is the button's content.
 * `pressed` is as on `Button`, and `"mixed"` marks a group that is partly on.
 * `iconShowsPressed` is for a toggle whose icon already shows its state, so on
 * draws no fill.
 */
export function IconButton(
  props: Omit<NativeButtonProps, "aria-label"> &
    Expands & {
      icon: IconName | "disclosure";
      label: string;
      "aria-label"?: never;
      "aria-expanded"?: never;
      description?: ReactNode;
      pin?: boolean;
      size?: ButtonSize;
    } & (
      | { variant: "primary"; pressed?: never; iconShowsPressed?: never }
      | { variant?: "secondary" | "ghost"; pressed?: boolean | "mixed" | undefined; iconShowsPressed?: never }
      | { variant?: "secondary" | "ghost"; pressed: boolean | "mixed"; iconShowsPressed: true }
    ),
) {
  const {
    icon,
    label,
    description,
    popoverOpen,
    expanded,
    pin,
    variant = "ghost",
    pressed,
    iconShowsPressed,
    size = 24,
    className,
    ...rest
  } = props;
  return (
    <Described text={description ?? label} popoverOpen={popoverOpen ?? false} pin={pin ?? false}>
      <button
        {...rest}
        type="button"
        className={className ? `ui-button ${className}` : "ui-button"}
        data-variant={variant}
        data-size={size}
        data-icon-only
        data-icon-shows-pressed={iconShowsPressed}
        aria-pressed={pressed}
        aria-expanded={popoverOpen ?? expanded}
        data-popover={popoverOpen === undefined ? undefined : ""}
        aria-label={label}
      >
        {icon === "disclosure" ? <DisclosureIcon /> : <Icon name={icon} />}
      </button>
    </Described>
  );
}

/**
 * A chevron for a control that shows or hides content in place. It points
 * down while the control's `aria-expanded` is true, or in the `summary` of
 * an open `details`, and right otherwise.
 */
export function DisclosureIcon() {
  return (
    <span className="ui-disclosure" aria-hidden="true">
      <Icon name="chevronDown" size={12} />
    </span>
  );
}
