import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useEventListener } from "../effects.ts";
import { IconButton } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Heading } from "../ui/Text.tsx";
import { wholeRowsHeight } from "./wholeRows.ts";

const Clipped = createContext(false);

export const useClippedBody = (): boolean => useContext(Clipped);

export function MapPopover(props: {
  title: string;
  className?: string;
  actions?: ReactNode;
  facts: { label: string; value: ReactNode }[];
  onClose: () => void;
  onEscape?: () => boolean;
  returnFocus: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const close = () => {
    if (section.current?.contains(document.activeElement)) props.returnFocus();
    props.onClose();
  };
  useEventListener(
    () => document,
    "keydown",
    (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || (e.target instanceof Element && e.target.closest("dialog"))) return;
      if (!props.onEscape?.()) close();
    },
  );
  const body = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const fit = () => {
    const el = body.current;
    if (!el) return;
    const { scrollTop } = el;
    el.style.maxHeight = "";
    el.removeAttribute("data-clipped");
    const overflows = el.scrollHeight > el.clientHeight;
    if (overflows) {
      el.setAttribute("data-clipped", "");
      const box = el.getBoundingClientRect();
      el.style.maxHeight = `${wholeRowsHeight(el, POPOVER_ROWS, box.top, box.height)}px`;
    }
    setClipped(overflows);
    // Growing the body to measure it pulls a body scrolled to its end back up.
    el.scrollTop = scrollTop;
  };
  useLayoutEffect(fit);
  useEffect(() => {
    // Row heights can change when the web fonts load.
    const fonts = "fonts" in document ? document.fonts : undefined;
    fonts?.addEventListener("loadingdone", fit);
    const strip = section.current!.closest(".map-top");
    const observer = strip && typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : undefined;
    for (const room of [strip, strip?.querySelector(":scope > .map-top-bound")]) if (room) observer?.observe(room);
    return () => {
      fonts?.removeEventListener("loadingdone", fit);
      observer?.disconnect();
    };
  }, []);
  useFocusInViewAfterResize(body);
  return (
    <Card
      as="section"
      layer
      ref={section}
      className={props.className ? `map-popover ${props.className}` : "map-popover"}
      aria-labelledby={titleId}
    >
      <header>
        <Heading level={3} size="body" id={titleId}>
          {props.title}
        </Heading>
        {props.actions}
        <IconButton icon="x" label="Close" onClick={close} />
      </header>
      <div ref={body} className="map-popover-body">
        <Clipped.Provider value={clipped}>
          <dl>
            {props.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {props.children}
        </Clipped.Provider>
      </div>
    </Card>
  );
}

const POPOVER_ROWS = ":scope > *, dd, li, label, p";

function useFocusInViewAfterResize(body: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") return;
    const scroller = body.current!;
    const hiddenPart = (control: Element) => {
      const r = control.getBoundingClientRect();
      const top = scroller.getBoundingClientRect().top + scroller.clientTop;
      return (Math.max(0, top - r.top) + Math.max(0, r.bottom - top - scroller.clientHeight)) / r.height;
    };
    let focusShown = false;
    const shown = new IntersectionObserver((entries) => (focusShown = entries.at(-1)!.isIntersecting), { root: scroller });
    const follow = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return;
      focusShown = hiddenPart(e.target) < 1;
      shown.disconnect();
      shown.observe(e.target);
    };
    scroller.addEventListener("focusin", follow);
    const resized = new ResizeObserver(() => {
      const focus = document.activeElement!;
      if (focusShown && scroller.contains(focus) && hiddenPart(focus) > 0) focus.scrollIntoView({ block: "nearest" });
    });
    resized.observe(scroller);
    return () => {
      scroller.removeEventListener("focusin", follow);
      shown.disconnect();
      resized.disconnect();
    };
  }, [body]);
}
