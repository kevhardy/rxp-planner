import { createContext, createElement, useContext, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { varsStyle, type Vars } from "./vars.ts";

const InCard = createContext(false);

/**
 * A card never sits inside another card, so a nested `Card` throws in tests
 * and dev builds. A production build renders it, because the app has no error
 * boundary and the throw would blank the whole app. A `layer` card, such as a
 * menu or a popover, opens above whatever holds its button, so it may open
 * from inside a card.
 */
export function Card(
  props: Omit<HTMLAttributes<HTMLElement>, "style"> & {
    style?: never;
    as?: "div" | "section" | "aside";
    layer?: boolean;
    vars?: Vars | undefined;
    hidden?: boolean | undefined;
    ref?: Ref<HTMLElement>;
    children?: ReactNode;
  },
) {
  const { as = "div", layer, vars, className, children, ...rest } = props;
  const inCard = useContext(InCard);
  if (import.meta.env.DEV && inCard && !layer)
    throw new Error("A Card cannot sit inside a Card. A menu or popover that opens from inside one is a layer Card.");
  return createElement(
    as,
    { ...rest, className: className ? `ui-card ${className}` : "ui-card", style: varsStyle(vars) },
    <InCard.Provider value>{children}</InCard.Provider>,
  );
}
