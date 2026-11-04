import { mobsAt, type MobView } from "../../rules/index.ts";
import type { GuideMapView } from "../map/MapPanel.tsx";
import { toScreen } from "../routing/lines.ts";
import { useMoment, usePlayback } from "./store.ts";

const LABEL_GAP = 26;

export function MobMarkers({ view }: { view: GuideMapView }) {
  const moment = useMoment();
  const playhead = usePlayback((s) => s.playhead);
  const timeline = usePlayback((s) => (s.status.kind === "ready" ? s.status.playback.timeline : undefined));
  if (!timeline) return null;
  const placed = mobsAt(timeline, playhead, moment?.activity).flatMap((mob) => {
    const at = view.surface.projectOutline(mob.at);
    return at ? [{ mob, xy: toScreen(at, view.pxPerPercent, view.surface.aspect) }] : [];
  });
  const dead = placed.filter((p) => p.mob.dead).sort((a, b) => a.mob.dead!.until - b.mob.dead!.until);
  const labeled: [number, number][] = [];
  return (
    <div className="mob-layer" aria-hidden="true">
      {placed.map(
        ({ mob, xy: [x, y] }) => !mob.dead && <span key={key(mob)} className="mob" style={{ "--at-x": `${x}px`, "--at-y": `${y}px` }} />,
      )}
      {dead.map(({ mob, xy: [x, y] }) => {
        const { since, until } = mob.dead!;
        const label = !labeled.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < LABEL_GAP) && labeled.push([x, y]);
        return (
          <span key={`${key(mob)} ${since}`} className="mob dead" style={{ "--at-x": `${x}px`, "--at-y": `${y}px` }}>
            {label && <span className="mob-countdown">{Math.ceil(until - playhead)}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function MobLegend() {
  return (
    <ul className="layer-legend mob-legend">
      <li>
        <span className="mob" aria-hidden="true" />
        Nearby mob for the current objective or grind
      </li>
      <li>
        <span className="mob dead" aria-hidden="true">
          <span className="mob-countdown">42</span>
        </span>
        Killed mob, with the seconds until the simulated respawn
      </li>
    </ul>
  );
}

const key = ({ at }: MobView) => at.id;
