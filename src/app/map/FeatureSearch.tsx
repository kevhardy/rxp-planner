import { useState } from "react";
import type { MapLocation } from "../../data/index.ts";
import { useTimeout } from "../effects.ts";
import { Icon } from "../icons.tsx";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Field.tsx";
import { locationGroups, type Feature, type FeatureLocation } from "./features.ts";
import { ADD_COMMANDS, type AddCommand } from "./points.ts";
import { Heading } from "../ui/Text.tsx";

const describe = (feature: Feature): string => [feature.kind, ...featureDetails(feature)].join(" · ");

export function featureDetails(feature: Feature): string[] {
  const parts = [];
  if (feature.entity) parts.push(`${feature.entity.type} #${feature.entity.id}`);
  if (feature.locations.length > 1) parts.push(`${feature.locations.length} locations`);
  return parts;
}

export function FeatureCard(props: {
  feature: Feature;
  area: string | undefined;
  onShow: (location: FeatureLocation) => void;
  add?: { step: number | null; onAdd: (location: MapLocation, command: AddCommand) => void };
}) {
  const { feature, add } = props;
  return (
    <div className="feature-card">
      <Heading level={4} size="body">
        {feature.name} <span className="muted">{describe(feature)}</span>
      </Heading>
      <CopyReference text={feature.copy} />
      {add && add.step === null && <p className="muted">Select a step to add points to it.</p>}
      {locationGroups(feature, props.area).map((group) => (
        <section key={group.area} aria-label={group.area}>
          <Heading level={5} size="small" tone="muted">
            {group.area}
          </Heading>
          <ul>
            {group.locations.map((l, i) => (
              <li key={i}>
                <span>{l.label}</span>
                <span className="actions">
                  <Button variant="secondary" aria-label={`Show on map: ${group.area} ${l.label}`} onClick={() => props.onShow(l)}>
                    Show on map
                  </Button>
                  {add &&
                    ADD_COMMANDS.map((command) => (
                      <Button
                        key={command}
                        variant="secondary"
                        aria-label={`Add .${command} to step: ${group.area} ${l.label}`}
                        disabled={add.step === null || !l.location}
                        onClick={() => l.location && add.onAdd(l.location, command)}
                      >
                        Add .{command}
                      </Button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CopyReference(props: { text: string }) {
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  useTimeout(() => setStatus(null), status && !status.failed ? 2000 : null, status);
  return (
    <div className="copy-reference">
      <Button
        variant="secondary"
        onClick={() => {
          // `navigator.clipboard` is missing outside secure contexts.
          Promise.resolve()
            .then(() => navigator.clipboard.writeText(props.text))
            .then(() => setStatus({ text: "Copied", failed: false }))
            .catch((error: unknown) =>
              setStatus({ text: `Copy failed: ${error instanceof Error ? error.message : String(error)}`, failed: true }),
            );
        }}
      >
        <Icon name="copy" />
        Copy reference
      </Button>
      <code>{props.text}</code>
      <span className="status" role="status">
        {status?.text}
      </span>
      {status?.failed && (
        <Input
          readOnly
          mono
          className="copy-reference-text"
          aria-label="Reference text to copy"
          value={props.text}
          onFocus={(e) => e.target.select()}
        />
      )}
    </div>
  );
}
