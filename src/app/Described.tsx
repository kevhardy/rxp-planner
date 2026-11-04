import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useOverlayRoot } from "./overlayRoot.ts";

/*
 * Descriptions, the app's tooltips; the app uses no `title` attributes.
 *
 *   <Described text="Undo the last edit (Ctrl+Z)">
 *     <Button variant="ghost">Undo</Button>
 *   </Described>
 *
 * - `children`: one DOM element: a control, or a label or span around one.
 *   It gets the hover and focus handlers and a ref; no wrapper is added.
 * - `text`: the description, usually a string. Without it the child renders
 *   alone.
 * - `popoverOpen`: true while a popover opened from the control is open,
 *   which hides the description.
 * - `hover`: false shows the description only for keyboard focus, for a
 *   control whose hover shows other details.
 * - `open`: true shows the description without hover or focus, such as for
 *   the selected option of a listbox the keyboard moves through.
 * - `pin`: true lets a click pin the description open. A second click,
 *   Escape, or a press outside the child unpins it.
 * - `clipped`: true when `text` repeats the child's own text, which may be
 *   cut off. The description shows only while an ellipsis or a line clamp in
 *   the child cuts off its text, and links no `aria-describedby`,
 *   since the child already holds the full text.
 *
 * The description shows on hover and on focus within that follows a key
 * press, and hides when both end. A link inside the child has its own
 * description, so hovering or focusing it hides this one. A press or Escape
 * hides it until the pointer or focus leaves; typing hides it until focus
 * leaves. It is dismissed when its pane scrolls it out of view or a dialog
 * makes `#app` inert, until the next hover or focus, or the next change of
 * `open`. The control, the child or the first control inside it, gets
 * `aria-describedby` unless its `aria-label` already says the same. The tooltip renders in `document.body`, or in the
 * open dialog that holds the child, with fixed positioning, so no pane clips it. It sits above the child, left-aligned,
 * and moves inside the nearest `data-tip-bounds` ancestor, else `#app`, and
 * inside the window, following the child each frame while shown. Below a
 * child in the banner, it also clears the ruler's band (`--ruler-band`) and
 * the banner's rule. Above or below a map mark with keyboard focus, it clears
 * the mark's ring (`--mark-reach`, the px that the ring reaches past the
 * mark's box).
 */

type Child = ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;

const CONTROL = 'input, select, textarea, button, [role="textbox"]';
const GAP = 6;
const EDGE_MARGIN = 4;

let keyboard = false;
const onPointerDown = () => (keyboard = false);
const onKeyDown = () => (keyboard = true);
document.addEventListener("pointerdown", onPointerDown, true);
document.addEventListener("keydown", onKeyDown, true);
import.meta.hot?.dispose(() => {
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
});

export function Described(props: {
  text?: ReactNode;
  popoverOpen?: boolean;
  hover?: boolean;
  open?: boolean;
  pin?: boolean;
  clipped?: boolean;
  children: Child;
}) {
  const { text, children } = props;
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [typed, setTyped] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [away, setAway] = useState(false);
  const overlayRoot = useOverlayRoot();
  const [wasOpen, setWasOpen] = useState(props.open);
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    setAway(false);
  }
  const shown =
    !!text &&
    (pinned || (((hover && props.hover !== false) || focus || (!!props.open && !away)) && !pressed && !typed && !props.popoverOpen));

  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el || !text || props.clipped) return;
    const control = el.matches(CONTROL) ? el : (el.querySelector<HTMLElement>(CONTROL) ?? el);
    if (control.getAttribute("aria-label") === text) return;
    const link = (on: boolean) => {
      const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== id);
      if (on) ids.push(id);
      if (ids.length > 0) control.setAttribute("aria-describedby", ids.join(" "));
      else control.removeAttribute("aria-describedby");
    };
    link(true);
    return () => link(false);
  });

  useLayoutEffect(() => {
    const el = anchor.current;
    const box = tip.current;
    if (!shown || !el || !box) return;
    let frame = 0;
    const place = () => {
      const style = getComputedStyle(el);
      const band = parseFloat(style.getPropertyValue("--ruler-band")) || 0;
      const reach = (el.matches(":focus-visible") && parseFloat(style.getPropertyValue("--mark-reach"))) || 0;
      const at = el.getBoundingClientRect();
      const bounds = (el.closest("[data-tip-bounds]") ?? document.getElementById("app"))?.getBoundingClientRect() ?? {
        top: 0,
        left: 0,
        right: innerWidth,
        bottom: innerHeight,
      };
      if (el.closest("[inert]") || at.bottom < bounds.top || at.top > bounds.bottom) {
        setHover(false);
        setFocus(false);
        setPinned(false);
        setAway(true);
        return;
      }
      const { left, top } = placeTip(at, box.getBoundingClientRect(), bounds, { above: reach, below: Math.max(band && band + 1, reach) });
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      frame = requestAnimationFrame(place);
    };
    place();
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPressed(true);
      setPinned(false);
    };
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) setPinned(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [shown]);

  const own = children.props;
  const control = !text
    ? children
    : cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          anchor.current = el;
          if (typeof own.ref === "function") own.ref(el);
          else if (own.ref) own.ref.current = el;
        },
        onPointerOver: (e) => {
          own.onPointerOver?.(e);
          setHover(!inLink(e) && (!props.clipped || cut(e.currentTarget)));
        },
        onPointerLeave: (e) => {
          own.onPointerLeave?.(e);
          setHover(false);
          setPressed(false);
        },
        onPointerDown: (e) => {
          own.onPointerDown?.(e);
          setPressed(true);
        },
        onClick: (e) => {
          own.onClick?.(e);
          if (props.pin) setPinned(!pinned);
        },
        onFocus: (e) => {
          own.onFocus?.(e);
          setFocus(keyboard && !inLink(e) && (!props.clipped || cut(e.currentTarget)));
        },
        onBlur: (e) => {
          own.onBlur?.(e);
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setFocus(false);
          setTyped(false);
          setPressed(false);
        },
        onInput: (e) => {
          own.onInput?.(e);
          setTyped(true);
        },
      });
  return (
    <>
      {control}
      {text &&
        createPortal(
          <span ref={tip} id={id} role="tooltip" className="tip" hidden={!shown}>
            {text}
          </span>,
          overlayRoot,
        )}
    </>
  );
}

function inLink(e: SyntheticEvent) {
  const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
  return !!link && link !== e.currentTarget && e.currentTarget.contains(link);
}

function cut(el: Element) {
  return [el, ...el.querySelectorAll("*")].some((x) => {
    const style = getComputedStyle(x);
    const truncates = style.textOverflow === "ellipsis" || Number(style.webkitLineClamp) > 0;
    return truncates && style.overflow !== "visible" && (x.scrollWidth > x.clientWidth || x.scrollHeight > x.clientHeight);
  });
}

function placeTip(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  tip: Pick<DOMRect, "width" | "height">,
  bounds: Pick<DOMRect, "top" | "left" | "right" | "bottom">,
  clear: { above: number; below: number },
) {
  const left = anchor.left + tip.width > bounds.right - EDGE_MARGIN ? anchor.right - tip.width : anchor.left;
  const above = anchor.top - clear.above - GAP - tip.height;
  const top = above < bounds.top + EDGE_MARGIN ? anchor.bottom + clear.below + GAP : above;
  return {
    left: fit(fit(left, tip.width, bounds.left, bounds.right), tip.width, 0, innerWidth),
    top: fit(fit(top, tip.height, bounds.top, bounds.bottom), tip.height, 0, innerHeight),
  };
}

function fit(start: number, size: number, low: number, high: number) {
  return Math.max(low + EDGE_MARGIN, Math.min(start, high - EDGE_MARGIN - size));
}
