import type { ReactNode } from "react";
import type { NativeButtonProps } from "./Button.tsx";
import { Described } from "../Described.tsx";
import { varsStyle, type Vars } from "./vars.ts";

/**
 * An item with `aria-current` shows the "current" look. `pressed` makes it an
 * on/off toggle with no on fill, because a column of filled rows reads as a
 * selection. Its `className` shows the state on one part, such as a Legend
 * row's eye. `chosen` marks the one item of its list that the user chose, and
 * shows the "current" look. `objective` is a CSS color, such as
 * `var(--objective-2)`.
 */
export function ItemButton(
  props: NativeButtonProps & { objective?: string; children: ReactNode } & (
      | { pressed?: boolean; chosen?: never }
      | { chosen: boolean; pressed?: never }
    ),
) {
  const { pressed, chosen, objective, className, children, ...rest } = props;
  return (
    <button
      {...rest}
      type="button"
      className={className ? `ui-item ${className}` : "ui-item"}
      style={{ "--objective": objective }}
      aria-pressed={pressed ?? chosen}
      data-chosen={chosen !== undefined || undefined}
      data-objective={objective === undefined ? undefined : ""}
    >
      {children}
    </button>
  );
}

/** A button whose look is its own art. The primitive adds no fill, border, or hover. */
export function ArtButton(props: NativeButtonProps & { children: ReactNode }) {
  const { className, children, ...rest } = props;
  return (
    <button {...rest} type="button" className={className ? `ui-art ${className}` : "ui-art"}>
      {children}
    </button>
  );
}

/**
 * `at` is the mark's place in percent of the map view. Without `at`, the
 * parent places the mark. The mark's own class draws its art, its focus ring,
 * and its look while `pressed`. `label` is its accessible name and its
 * tooltip. `popoverOpen` is as on `Button`, and hides the tooltip while the
 * popover is open.
 *
 * A mark has no 24px hit area, because marks often sit closer than 24px, and a
 * larger hit area would pick the wrong one. WCAG 2.5.8 exempts map pins as
 * essential.
 */
export function MarkButton(
  props: Omit<NativeButtonProps, "aria-label"> & {
    label: string;
    "aria-label"?: never;
    at?: { x: number; y: number };
    vars?: Vars;
    pressed?: boolean;
    popoverOpen?: boolean;
    children?: ReactNode;
  },
) {
  const { label, at, vars, pressed, popoverOpen, className, children, ...rest } = props;
  return (
    <Described text={label} popoverOpen={popoverOpen ?? false}>
      <button
        {...rest}
        type="button"
        className={className ? `ui-mark ${className}` : "ui-mark"}
        // oxlint-disable-next-line rxpplanner/no-inline-style -- The rule checks each caller's `vars` literal, and `varsStyle` checks each key.
        style={{ ...varsStyle(vars), "--at-x": at && `${at.x}%`, "--at-y": at && `${at.y}%` }}
        aria-pressed={pressed}
        aria-expanded={popoverOpen ?? rest["aria-expanded"]}
        aria-label={label}
      >
        {children}
      </button>
    </Described>
  );
}
