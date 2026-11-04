import { useEffect, useState } from "react";
import { Icon } from "./icons.tsx";
import { APP_MIN_WIDTH } from "./layout.ts";

const NARROW = `(width < ${APP_MIN_WIDTH}px)`;

/**
 * A screen reader skips the text that a live region holds when it first
 * appears, so the text comes a frame after mount.
 */
export function NarrowNotice() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return;
    const update = () => setNarrow(query.matches);
    const frame = requestAnimationFrame(update);
    query.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      query.removeEventListener("change", update);
    };
  }, []);
  return (
    <div className="narrow-notice" role="status">
      {narrow && (
        <p>
          <Icon name="warning" />
          RXP Planner needs a window at least {APP_MIN_WIDTH}px wide. Until then, the page scrolls sideways.
        </p>
      )}
    </div>
  );
}
