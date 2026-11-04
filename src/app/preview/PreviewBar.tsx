import { useId, useRef, useState } from "react";
import { GAME, xpRate, xpRateOptions } from "../../rules/index.ts";
import { PLAYABLE_RACES, RACE_FACTION, raceClassOptions, type ClassName, type PlayableRace } from "../../data/index.ts";
import { useGameData } from "../context.ts";
import { Described } from "../Described.tsx";
import { useOutsidePress } from "../effects.ts";
import { Icon } from "../icons.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Field, Select } from "../ui/Field.tsx";
import { legalClass, profileOf, usePreviewSettings, useSettingsStore, type PreviewSettings } from "./settings.ts";

const RACE_NAMES: Record<PlayableRace, string> = {
  Human: "Human",
  Dwarf: "Dwarf",
  NightElf: "Night Elf",
  Gnome: "Gnome",
  Orc: "Orc",
  Scourge: "Undead",
  Tauren: "Tauren",
  Troll: "Troll",
  HighOrder: "High Order",
  Windshaper: "Windshaper",
};

const className = (c: ClassName) => c[0] + c.slice(1).toLowerCase();
const XP_RATES = xpRateOptions(GAME);
const FIELD_DESCRIPTIONS = {
  Race: "Also sets the faction.",
  Class: "Only classes the race can be.",
  Trading: "SSF shows #ssf steps and hides #ah steps.",
  "XP rate": `The rate #xprate checks, ${XP_RATES[0]}× to ${XP_RATES.at(-1)}×. Default 1×.`,
};

export const characterName = (s: Pick<PreviewSettings, "race" | "class">) => `${RACE_NAMES[s.race]} ${className(s.class)}`;

const characterSummary = (s: PreviewSettings) => `${characterName(s)} · ${s.soloSelfFound ? "SSF" : "AH"}`;

export function PreviewAs() {
  const settings = usePreviewSettings();
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useOutsidePress(
    open,
    wrap,
    () => setOpen(false),
    () => wrap.current?.querySelector<HTMLElement>(".popover select"),
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Catches Escape and focus leaving from the button and popover inside.
    <span
      ref={wrap}
      className="preview-as"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <Described text="Preview character: race, class, trading, and XP rate" popoverOpen={open}>
        <Button
          ref={button}
          variant="secondary"
          size={32}
          className="preview-button"
          popoverOpen={open}
          aria-controls={popoverId}
          onClick={() => setOpen(!open)}
        >
          <Icon name="user" />
          <span className="sr-only">Preview as</span> <span className="preview-summary">{characterSummary(settings)}</span>
          <Icon name="chevronDown" />
        </Button>
      </Described>
      <Card as="section" layer id={popoverId} className="popover" aria-label="Character preview" hidden={!open}>
        <PreviewControls />
      </Card>
    </span>
  );
}

function PreviewControls() {
  const settings = usePreviewSettings();
  const settingsStore = useSettingsStore();
  const raceClasses = useGameData()?.raceClasses;
  const set = (change: Partial<PreviewSettings>) => settingsStore.update(change);
  const defaultRate = xpRate(profileOf({ ...settings, xpRate: null }, undefined));
  // RXP keeps a saved rate that its slider does not offer, so the list does too.
  const savedRate = settings.xpRate !== null && !XP_RATES.includes(settings.xpRate) ? settings.xpRate : null;
  const [classNote, setClassNote] = useState<string | null>(null);
  const classNoteId = useId();

  return (
    <div className="preview-controls">
      <Field label="Race" description={FIELD_DESCRIPTIONS.Race} className="preview-field">
        <Select
          value={settings.race}
          onChange={(e) => {
            const race = e.target.value as PlayableRace;
            const cls = legalClass(race, settings.class, raceClasses);
            setClassNote(
              cls === settings.class
                ? null
                : `${RACE_NAMES[race]} cannot be a ${className(settings.class)}. Class set to ${className(cls)}.`,
            );
            set({ race });
          }}
        >
          {(["Alliance", "Horde"] as const).map((faction) => (
            <optgroup key={faction} label={faction}>
              {PLAYABLE_RACES.filter((r) => RACE_FACTION[r] === faction).map((r) => (
                <option key={r} value={r}>
                  {RACE_NAMES[r]}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label="Class" description={FIELD_DESCRIPTIONS.Class} className="preview-field">
        <Select
          value={settings.class}
          aria-describedby={classNote ? classNoteId : undefined}
          onChange={(e) => {
            setClassNote(null);
            set({ class: e.target.value as ClassName });
          }}
        >
          {raceClassOptions(settings.race, raceClasses).map((c) => (
            <option key={c} value={c}>
              {className(c)}
            </option>
          ))}
        </Select>
      </Field>
      {classNote && (
        <span id={classNoteId} className="preview-note" role="status">
          {classNote}
        </span>
      )}
      <Field label="Trading" description={FIELD_DESCRIPTIONS.Trading} className="preview-field">
        <Select value={settings.soloSelfFound ? "ssf" : "ah"} onChange={(e) => set({ soloSelfFound: e.target.value === "ssf" })}>
          <option value="ah">Auction house</option>
          <option value="ssf">Solo self-found</option>
        </Select>
      </Field>
      <Field label="XP rate" description={FIELD_DESCRIPTIONS["XP rate"]} className="preview-field">
        <Select value={settings.xpRate ?? ""} onChange={(e) => set({ xpRate: e.target.value === "" ? null : Number(e.target.value) })}>
          <option value="">Default ({defaultRate}×)</option>
          {savedRate !== null && <option value={savedRate}>{savedRate}× (saved, outside RXP's slider)</option>}
          {XP_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
