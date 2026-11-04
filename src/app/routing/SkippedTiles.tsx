import { round, type TileOutlines } from "./lines.ts";

export function SkippedTiles(props: { tiles: TileOutlines }) {
  const { outlines, labels } = props.tiles;
  if (!outlines.length) return null;
  return (
    <>
      <svg className="skipped-tiles" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {outlines.map((corners, i) => (
          <polygon key={i} points={corners.map((p) => `${round(p.x)},${round(p.y)}`).join(" ")} />
        ))}
      </svg>
      {labels.map((at, i) => (
        <span key={i} className="skipped-label" aria-hidden="true" style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }}>
          No terrain data
        </span>
      ))}
    </>
  );
}
