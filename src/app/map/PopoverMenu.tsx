import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Described } from "../Described.tsx";
import { useOutsidePress } from "../effects.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Button, IconButton } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";

export function PopoverMenu(props: {
  className: string;
  label: string;
  description: string;
  align?: "start" | "end";
  beside?: string;
  icon?: IconName | undefined;
  disabled?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const [place, setPlace] = useState<Place>({});
  const align = props.align ?? "end";
  const { beside } = props;
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const el = popover.current!;
    const fit = () => {
      const next = fitPopover(button.current!, el, align, beside);
      setPlace((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    const refit = () => (outOfView(button.current!.getBoundingClientRect()) ? setOpen(false) : fit());
    fit();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
    observer?.observe(el);
    window.addEventListener("resize", refit);
    window.addEventListener("scroll", refit, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refit);
      window.removeEventListener("scroll", refit, true);
    };
  }, [open, align, beside]);

  useOutsidePress(open, wrap, () => setOpen(false));

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Catches Escape and focus leaving from the button and popover inside.
    <span
      ref={wrap}
      className={props.className}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      {props.icon ? (
        <IconButton
          ref={button}
          icon={props.icon}
          label={props.label}
          description={props.description}
          popoverOpen={open}
          aria-controls={popoverId}
          disabled={props.disabled}
          onClick={() => setOpen(!open)}
        />
      ) : (
        <Described text={props.description} popoverOpen={open}>
          <Button
            ref={button}
            variant="ghost"
            popoverOpen={open}
            aria-controls={popoverId}
            disabled={props.disabled}
            onClick={() => setOpen(!open)}
          >
            {props.label}
            <Icon name="chevronDown" />
          </Button>
        </Described>
      )}
      <Card
        as="section"
        layer
        ref={popover}
        id={popoverId}
        className="popover menu-popover"
        vars={{ "--at-x": place.x, "--at-y": place.y, "--at-bottom": place.bottom, "--size-w": place.w, "--size-h": place.h }}
        aria-label={props.label}
        hidden={!open}
      >
        {typeof props.children === "function" ? props.children(close) : props.children}
      </Card>
    </span>
  );
}

const EDGE_MARGIN = 8;
const GAP = 8;

function windowSize(): [number, number] {
  const root = document.documentElement;
  return [root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight];
}

function outOfView(r: DOMRect): boolean {
  const [width, height] = windowSize();
  return r.bottom <= 0 || r.top >= height || r.right <= 0 || r.left >= width;
}

const px = (n: number) => `${n}px`;

type Place = { x?: string; y?: string; bottom?: string; w?: string; h?: string };

function fitPopover(buttonEl: HTMLElement, el: HTMLElement, align: "start" | "end", beside: string | undefined): Place {
  const [width, height] = windowSize();
  const button = buttonEl.getBoundingClientRect();
  const maxWidth = width - 2 * EDGE_MARGIN;
  const w = Math.min(el.offsetWidth, maxWidth);
  const side = beside ? buttonEl.closest(beside)?.getBoundingClientRect().right : undefined;
  if (side !== undefined && side + GAP + w <= width - EDGE_MARGIN) {
    const maxHeight = height - 2 * EDGE_MARGIN;
    const top = Math.max(EDGE_MARGIN, Math.min(button.top, height - EDGE_MARGIN - Math.min(el.scrollHeight, maxHeight)));
    return { x: px(Math.round(side + GAP)), y: px(Math.round(top)), w: px(maxWidth), h: px(maxHeight) };
  }
  const left = Math.round(Math.min(Math.max(align === "start" ? button.left : button.right - w, EDGE_MARGIN), width - EDGE_MARGIN - w));
  const below = Math.floor(height - EDGE_MARGIN - button.bottom - GAP);
  const above = Math.floor(button.top - GAP - EDGE_MARGIN);
  const across = { x: px(left), w: px(maxWidth) };
  return el.scrollHeight > below && above > below
    ? { ...across, bottom: px(Math.round(height - button.top + GAP)), h: px(above) }
    : { ...across, y: px(Math.round(button.bottom + GAP)), h: px(Math.max(0, below)) };
}
