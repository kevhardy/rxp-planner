import type { RoutePlan } from "../../routing/plan.ts";
import { floorLines, measureLabel, routeOf } from "../../routing/result.ts";
import type { MapMenuItem } from "../map/MapCanvas.tsx";
import { MapPopover } from "../map/MapPopover.tsx";
import { Button } from "../ui/Button.tsx";
import { Radio } from "../ui/Checkbox.tsx";
import type { StopLevel } from "./Interiors.tsx";
import { FloorLines } from "./RouteResult.tsx";
import type { LegState } from "./routeSearch.ts";
import { levelOptions, stopLabel, stopName, yards } from "./stopNames.ts";

const legTime = (legs: readonly LegState[], i: number) => {
  const leg = legs[i]!;
  const time =
    leg.state === "pending"
      ? leg.phase
      : leg.state === "failed"
        ? "routing failed"
        : leg.summary.measure
          ? measureLabel(leg.summary.measure, leg.summary.kind)
          : leg.summary.label;
  return `leg ${i + 1}, ${time}`;
};

export function StopPopover(props: {
  plan: RoutePlan;
  index: number;
  where: StopLevel | undefined;
  legs: readonly LegState[];
  actions: MapMenuItem[];
  disabled: boolean;
  onLevel: (height: number | null, what: string) => void;
  act: (run: () => void) => () => void;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { plan, index: i, where, legs, disabled, onLevel, act } = props;
  const last = plan.stops.length - 1;
  const floors = [
    { leg: i - 1, side: 1 },
    { leg: i, side: 0 },
  ].flatMap(({ leg, side }) => {
    const state = legs[leg];
    const route = state?.state === "routed" ? routeOf(state.result) : undefined;
    return route ? floorLines(route).filter((line) => line.side === side) : [];
  });
  const levelPick = () => {
    const top = where?.surfaces.at(-1);
    if (!where || !top) return null;
    const world = where.onWorldMap;
    if (where.surfaces.length === 1)
      return (
        <div className="stop-levels">
          <p>Only one level here, at {Math.round(top.height)} yd.</p>
          <Button
            variant="secondary"
            pressed={world}
            disabled={disabled}
            onClick={act(() => (world ? onLevel(top.height, top.place) : onLevel(null, "the world map")))}
          >
            World map
          </Button>
        </div>
      );
    const name = `stop-level-${i}`;
    return (
      <fieldset className="stop-levels" disabled={disabled}>
        <legend>Level at {stopName(i, last)}</legend>
        {levelOptions(where).map(({ shown, spoken, checked, height, what }) => (
          <Radio key={what} name={name} label={shown} checked={checked} aria-label={spoken} onChange={() => onLevel(height, what)} />
        ))}
      </fieldset>
    );
  };
  return (
    <MapPopover
      title={stopLabel(i, last)}
      facts={[
        { label: "Point", value: yards(plan.stops[i]!) },
        ...(i > 0 ? [{ label: "Arrives by", value: legTime(legs, i - 1) }] : []),
        ...(i < last ? [{ label: "Leaves by", value: legTime(legs, i) }] : []),
      ]}
      onClose={props.onClose}
      returnFocus={props.returnFocus}
    >
      <FloorLines lines={floors} />
      {levelPick()}
      <div className="route-popover-actions">
        {props.actions.map((item) => (
          <Button key={item.label} variant="secondary" wrap disabled={disabled} onClick={act(item.run)}>
            {item.label}
          </Button>
        ))}
      </div>
    </MapPopover>
  );
}
