import type { ReactNode } from "react";
import type { ControlSize } from "./Button.tsx";
import { Icon, type IconName } from "../icons.tsx";

export interface Segment<T> {
  value: T;
  label: ReactNode;
  icon?: IconName;
}

export function Segmented<T extends string | null>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<Segment<T>>;
  onChange: (value: T) => void;
  size?: ControlSize;
  className?: string;
  style?: never;
  "aria-pressed"?: never;
}) {
  const { size = 24 } = props;
  return (
    <div
      className={props.className ? `ui-segmented ${props.className}` : "ui-segmented"}
      role="group"
      aria-label={props.label}
      data-size={size}
    >
      {props.options.map((option) => (
        <button
          key={option.value ?? ""}
          type="button"
          className="ui-segment"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
