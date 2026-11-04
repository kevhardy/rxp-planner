import { fitsSetting, PLAYBACK_SETTING_ENTRIES, resolvePlaybackSettings, type PlaybackSettingSpec } from "../../rules/index.ts";
import { DraftField } from "../fields.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { PopoverMenu } from "../map/PopoverMenu.tsx";
import { Button } from "../ui/Button.tsx";
import { Stack } from "../ui/Stack.tsx";
import { Text } from "../ui/Text.tsx";
import { usePlaybackChoices, usePlaybackSettingsStore } from "./settings.ts";

export function PlaybackSettingsMenu() {
  const store = usePlaybackSettingsStore();
  const choices = usePlaybackChoices();
  const settings = resolvePlaybackSettings(choices);
  const changed = Object.keys(choices).length;
  return (
    <PopoverMenu
      className="playback-settings"
      label={changed ? `Settings (${changed})` : "Settings"}
      description="How Playback plays the route"
    >
      {PLAYBACK_SETTING_ENTRIES.map(([key, spec]) => (
        <Stack key={key} direction="column" align="start" gap={1} className="playback-setting">
          <SettingControl spec={spec} value={settings[key]} onChange={(value) => store.update({ [key]: value })} />
          <Text as="p" size="small" tone="muted">
            {spec.description}
          </Text>
        </Stack>
      ))}
      <Button variant="secondary" onClick={() => store.reset()} disabled={changed === 0}>
        Reset to defaults
      </Button>
    </PopoverMenu>
  );
}

function SettingControl(props: { spec: PlaybackSettingSpec; value: number | boolean; onChange: (value: number | boolean) => void }) {
  const { spec, value, onChange } = props;
  switch (spec.kind) {
    case "number":
      return (
        <DraftField
          label={spec.label}
          draftName={spec.label}
          value={String(value)}
          hint={spec.unit}
          className="arg-short"
          mono
          onCommit={(text) => {
            const n = Number(text);
            if (text.trim() === "" || !fitsSetting(spec, n)) return `Enter a number from ${spec.min} to ${spec.max}.`;
            onChange(n);
            return null;
          }}
        />
      );
    case "toggle":
      return <Checkbox label={spec.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    default:
      spec satisfies never;
  }
}
