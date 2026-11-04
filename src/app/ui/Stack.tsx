import { createElement, type HTMLAttributes, type ReactNode } from "react";

/** The gap is this many times 4px. */
export type Space = 1 | 2 | 3 | 4 | 6 | 8;

export function Stack(
  props: Omit<HTMLAttributes<HTMLElement>, "style"> & {
    style?: never;
    as?: "div" | "span";
    direction?: "row" | "column";
    gap: Space;
    align?: "start" | "center" | "baseline" | "end";
    wrap?: boolean;
    children: ReactNode;
  },
) {
  const { as = "div", direction = "row", gap, align, wrap, className, children, ...rest } = props;
  return createElement(
    as,
    {
      ...rest,
      className: className ? `ui-stack ${className}` : "ui-stack",
      "data-direction": direction,
      "data-gap": gap,
      "data-align": align,
      "data-wrap": wrap || undefined,
    },
    children,
  );
}
