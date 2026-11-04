import { useRef, useState } from "react";
import { useLayout, useLayoutStore, type LayoutSize } from "./layout.ts";

const KEY_STEP = 16;

export function Gutter(props: {
  size: LayoutSize;
  label: string;
  /** "vertical" sits between columns and resizes a width. */
  orientation: "vertical" | "horizontal";
  /** -1 when the size grows as the gutter moves left or up. */
  direction?: 1 | -1;
  className?: string;
}) {
  const { size, orientation, direction = 1 } = props;
  const store = useLayoutStore();
  const value = useLayout()[size];
  const { min, max } = store.limits(size);
  const drag = useRef<{ from: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";

  const resize = (to: number, save = true) => store.update({ [size]: Math.round(Math.min(max, Math.max(min, to))) }, { save });
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    store.update({});
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={props.label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`gutter ${vertical ? "gutter-v" : "gutter-h"}${dragging ? " dragging" : ""}${props.className ? ` ${props.className}` : ""}`}
      onKeyDown={(e) => {
        const keys = vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
        const sign = keys[e.key as keyof typeof keys];
        if (!sign) return;
        e.preventDefault();
        resize(value + sign * KEY_STEP * direction);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { from: value, start: vertical ? e.clientX : e.clientY };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const moved = (vertical ? e.clientX : e.clientY) - drag.current.start;
        resize(drag.current.from + moved * direction, false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
