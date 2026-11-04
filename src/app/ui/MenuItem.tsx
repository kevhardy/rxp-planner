import type { ReactNode } from "react";
import type { NativeButtonProps } from "./Button.tsx";
import { Icon } from "../icons.tsx";

/** Out of the tab order, because the menu moves focus between its items with the arrow keys. */
export function MenuItem(props: NativeButtonProps & { checked?: boolean; radio?: boolean; children?: ReactNode }) {
  const { checked, radio, className, children, ...rest } = props;
  const role = checked === undefined ? "menuitem" : radio ? "menuitemradio" : "menuitemcheckbox";
  return (
    <button
      tabIndex={-1}
      {...rest}
      type="button"
      role={role}
      aria-checked={checked}
      className={className ? `ui-menu-item ${className}` : "ui-menu-item"}
    >
      {checked !== undefined && (
        <span className="ui-menu-check" aria-hidden="true">
          {checked && <Icon name="check" />}
        </span>
      )}
      {children}
    </button>
  );
}
