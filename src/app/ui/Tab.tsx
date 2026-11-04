import type { ReactNode } from "react";
import type { ControlSize, NativeButtonProps } from "./Button.tsx";

/** Only the selected tab is in the tab order, because the tablist moves focus between tabs with the arrow keys. */
export function Tab(props: NativeButtonProps & { selected: boolean; controls: string; size?: ControlSize; children: ReactNode }) {
  const { selected, controls, size = 24, className, children, ...rest } = props;
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      data-size={size}
      className={className ? `ui-tab ${className}` : "ui-tab"}
    >
      {children}
    </button>
  );
}
