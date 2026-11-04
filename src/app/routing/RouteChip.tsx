import type { RefObject } from "react";
import { Described } from "../Described.tsx";
import { Button } from "../ui/Button.tsx";
import { Select } from "../ui/Field.tsx";
import type { RouteStatus } from "./RouteResult.tsx";

export function RouteChip(props: {
  status: RouteStatus;
  disabled: boolean;
  mode: { names: readonly string[]; value: string; change: (name: string) => void } | undefined;
  search: { label: string; run: () => void } | undefined;
  summary: { shown: boolean; button: RefObject<HTMLButtonElement | null>; toggle: () => void } | undefined;
}) {
  const { mode } = props;
  return (
    <div className={`route-chip${props.status.tone ? ` route-${props.status.tone}` : ""}`}>
      {mode && (
        <Select disabled={props.disabled} aria-label="Mode" value={mode.value} onChange={(e) => mode.change(e.target.value)}>
          {mode.names.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </Select>
      )}
      {props.status.busy && <span className="route-busy" aria-hidden="true" />}
      <span aria-live="polite">{props.status.text}</span>
      {props.search && (
        <Button variant="secondary" onClick={props.search.run}>
          {props.search.label}
        </Button>
      )}
      {props.summary && (
        <Described text="The whole route's steps, time, and distance">
          <Button ref={props.summary.button} variant="secondary" pressed={props.summary.shown} onClick={props.summary.toggle}>
            Summary
          </Button>
        </Described>
      )}
    </div>
  );
}
