import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { AssetMap, Retains, Status } from "./async.ts";

type Listener<E> = (event: E) => void;

interface ListenerOptions {
  enabled?: boolean;
  passive?: boolean;
}

/** Calls the latest `listener`. Reads `target()` after each commit, so a ref's element can mount later. */
export function useEventListener<K extends keyof WindowEventMap>(
  target: () => Window | null | undefined,
  type: K,
  listener: Listener<WindowEventMap[K]>,
  options?: ListenerOptions,
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
  target: () => Document | null | undefined,
  type: K,
  listener: Listener<DocumentEventMap[K]>,
  options?: ListenerOptions,
): void;
export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: () => HTMLElement | null | undefined,
  type: K,
  listener: Listener<HTMLElementEventMap[K]>,
  options?: ListenerOptions,
): void;
export function useEventListener(
  target: () => EventTarget | null | undefined,
  type: string,
  listener: Listener<Event>,
  options: ListenerOptions = {},
): void {
  const { enabled = true, passive } = options;
  const onEvent = useEffectEvent(listener);
  const bound = useRef<{ on: EventTarget; type: string; passive: boolean | undefined; remove: () => void } | null>(null);
  useEffect(() => {
    const on = (enabled && target()) || null;
    const was = bound.current;
    if (was?.on === on && was.type === type && was.passive === passive) return;
    was?.remove();
    bound.current = null;
    if (!on) return;
    const handle = (event: Event) => onEvent(event);
    on.addEventListener(type, handle, passive === undefined ? {} : { passive });
    bound.current = { on, type, passive, remove: () => on.removeEventListener(type, handle) };
  });
  useEffect(
    () => () => {
      bound.current?.remove();
      bound.current = null;
    },
    [],
  );
}

/** `focus` gives the control to focus each time `open` turns true. */
export function useOutsidePress(
  open: boolean,
  inside: RefObject<Element | null>,
  onOutside: () => void,
  focus?: () => HTMLElement | null | undefined,
): void {
  const focusOpened = useEffectEvent(() => focus?.()?.focus());
  useEffect(() => {
    if (open) focusOpened();
  }, [open]);
  useEventListener(
    () => document,
    "pointerdown",
    (e) => {
      if (!(e.target instanceof Node) || !inside.current?.contains(e.target)) onOutside();
    },
    { enabled: open },
  );
}

/**
 * The open state of a popover that `button` toggles, with the props of the element that wraps both. `onOpen` runs
 * on each toggle that opens it, and then the element that `focus` finds in the wrapper takes focus. Escape and
 * `close` close it and focus `button`. With `lightDismiss`, a press or focus outside the wrapper closes it without
 * focusing `button`.
 */
export function useDisclosure(
  options: { focus?: (wrap: HTMLElement) => HTMLElement | null; lightDismiss?: boolean; onOpen?: (() => void) | undefined } = {},
) {
  const { focus, lightDismiss = true, onOpen } = options;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusAfterCommit = useRef<true | null>(null);
  usePendingAction(focusAfterCommit, () => button.current?.focus());
  const dismiss = useCallback(() => setOpen(false), []);
  const close = () => {
    setOpen(false);
    // Focus moves now, so that a later handler or effect can move it on.
    if (button.current) button.current.focus();
    else focusAfterCommit.current = true;
  };
  useOutsidePress(
    open,
    wrap,
    () => lightDismiss && dismiss(),
    () => (focus && wrap.current ? focus(wrap.current) : null),
  );
  return {
    open,
    toggle: () => {
      if (!open) onOpen?.();
      setOpen(!open);
    },
    close,
    dismiss,
    button,
    wrap: {
      ref: wrap,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      },
      onBlur: (e: FocusEvent) => {
        const to = e.relatedTarget;
        if (lightDismiss && to && !e.currentTarget.contains(to)) dismiss();
      },
    },
  };
}

/** Retains `key` of `owner` while mounted; `null` retains nothing. */
export function useRetain<K>(owner: Retains<K>, key: K | null): void {
  useEffect(() => (key === null ? undefined : owner.retain(key)), [owner, key]);
}

/** Retains each of `keys` while mounted, and gives their states in order. Undefined until a key is first retained. */
export function useAssets<K, V>(assets: AssetMap<K, V>, keys: readonly K[]): readonly (Status<V> | undefined)[] {
  useEffect(() => {
    const releases = keys.map((key) => assets.retain(key));
    return () => {
      for (const release of releases) release();
    };
  }, [assets, keys]);
  const read = useMemo(() => {
    let shown: readonly (Status<V> | undefined)[] = [];
    return () => {
      const states = keys.map((key) => assets.peek(key));
      if (states.length !== shown.length || states.some((state, i) => state !== shown[i])) shown = states;
      return shown;
    };
  }, [assets, keys]);
  return useSyncExternalStore(assets.subscribe, read);
}

/** Calls the latest `fire` after `delay` ms. A new `delay` or `key` restarts the wait, and `null` cancels it. */
export function useTimeout(fire: () => void, delay: number | null, key?: unknown): void {
  const onFire = useEffectEvent(fire);
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => onFire(), delay);
    return () => clearTimeout(timer);
  }, [delay, key]);
}

/** After each render, calls `update` before paint, then each frame until it returns false. */
export function useEachFrame(update: () => boolean | void): void {
  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      if (update() !== false) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  });
}

/** After each commit, clears `pending` and passes its value to `perform`, so `perform` gets each value once. */
export function usePendingAction<T>(pending: RefObject<T | null>, perform: (value: T) => void): void {
  useEffect(() => {
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    perform(value);
  });
}

/** The element's width in whole px, or `Infinity` before the first measure and where the browser has no `ResizeObserver`. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(Infinity);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // `clientWidth` rounds, and can round a fractional track up past its edge.
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // React renders the observer's first update after the first paint.
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
