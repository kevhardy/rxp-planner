import type { ReactNode } from "react";
import type { MarkKind } from "../rules/index.ts";
import type { VectorKind } from "./guideIcon.ts";

// Shapes, not font glyphs, because a fallback font can place a symbol
// off-center in the box. Each shape is centered on (8, 8).
const other = <path d="M5 8h6" />;

const SHAPES: Partial<Record<MarkKind, ReactNode>> = {
  complete: <path d="M8 3.75 12.25 8 8 12.25 3.75 8z" fill="currentColor" />,
  hs: <path d="M3.75 7.75 8 4l4.25 3.75M5 6.75V12h6V6.75" />,
  target: (
    <>
      <circle cx="8" cy="5.5" r="3" />
      <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
    </>
  ),
  use: (
    <path
      d="M8 3.5c.35 2.3 2.2 4.15 4.5 4.5-2.3.35-4.15 2.2-4.5 4.5-.35-2.3-2.2-4.15-4.5-4.5 2.3-.35 4.15-2.2 4.5-4.5z"
      fill="currentColor"
      strokeWidth={0.5}
    />
  ),
  equip: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <rect x="6.5" y="6.5" width="3" height="3" fill="currentColor" stroke="none" />
    </>
  ),
  cast: <path d="M9.5 3 5.25 9h3l-1.75 4 4.25-6h-3z" fill="currentColor" strokeWidth={1} />,
  check: <path d="M3.75 4.25h8.5L8 11.75z" />,
  setting: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle
        cx="8"
        cy="8"
        r="4.5"
        pathLength={8}
        strokeWidth={2.25}
        strokeDasharray="0.45 0.55"
        strokeDashoffset={0.225}
        strokeLinecap="butt"
      />
    </>
  ),
  note: <path d="M4.5 5h7M4.5 8h7M4.5 11h7" />,
  tag: <path d="m6.5 3.5-1 9M10.5 3.5l-1 9M3.75 6.25h8.5M3.75 9.75h8.5" />,
  checkpoint: <path d="M4 3.5h8M8 12.5V6.5M5 9.5l3-3 3 3" />,
  path: other,
  tame: other,
  engrave: other,
  reputation: other,
  other,
} satisfies Record<Exclude<MarkKind, VectorKind>, ReactNode>;

/** A mark kind's shape, in the current text color, for a 16 px box. */
export function MarkShape({ kind }: { kind: MarkKind }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[kind]}
    </svg>
  );
}
