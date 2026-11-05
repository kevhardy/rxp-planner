import { useId, useState } from "react";
import { ENTITY_TYPES, type Entity, type EntityType } from "../data/index.ts";
import { argumentEntities, argumentIdSlot, guideText, insertEntityReference } from "../guide/index.ts";
import { Dialog } from "./Dialog.tsx";
import { useEntityNames, type EntityNames } from "./EntityLink.tsx";
import { GuideText } from "./GuideText.tsx";
import { moveActive, OptionList, type FieldText, type Suggestions } from "./fields.tsx";
import { Button, IconButton } from "./ui/Button.tsx";
import { Field, Input } from "./ui/Field.tsx";
import { Segmented } from "./ui/Segmented.tsx";

const LIMIT = 20;

const TYPE_NAMES: Record<EntityType, string> = { item: "Item", quest: "Quest", npc: "NPC", spell: "Spell", object: "Object" };

function EntityOption(props: { entity: Entity }) {
  const { entity } = props;
  return (
    <>
      <span className="option-name">{entity.name}</span> {entity.subtext && <span className="entity-sub">{entity.subtext} </span>}
      <span className="option-id">#{entity.id}</span>
    </>
  );
}

/**
 * Entities for argument `index` of a command, searched by the name or ID at
 * `caret`. Each choice puts the entity's ID in the argument's ID part and
 * keeps the syntax around it. A choice that RXP would not read as that
 * entity, such as a lone `.skipgossip` value up to 9, carries an error.
 * An ID that the names lack gets no list, since it may still be right.
 */
export function argumentSuggestions(
  names: EntityNames,
  command: string,
  args: readonly string[],
  index: number,
  caret: number,
): Suggestions | undefined {
  const value = args[index] ?? "";
  const slot = argumentIdSlot(command, args, index, caret);
  const query = slot && value.slice(slot.start, slot.end).trim();
  if (!slot || !query) return undefined;
  const found = names.search(slot.type, query, LIMIT);
  if (!found) {
    const status = names.status(slot.type, true);
    return { options: [], ...(status && { status }) };
  }
  if (found.length === 0) return /^\d+$/.test(query) ? undefined : { options: [], status: `No ${TYPE_NAMES[slot.type]} matches.` };
  return {
    options: found.map((entity) => {
      const id = String(entity.id);
      const next = [...args];
      next[index] = value.slice(0, slot.start) + id + value.slice(slot.end);
      const read = argumentEntities(command, next, index).some((e) => e.type === entity.type && e.id === entity.id);
      return {
        key: id,
        label: <EntityOption entity={entity} />,
        value: next[index],
        caret: slot.start + id.length,
        ...(!read && { error: `RXP would not read ${next[index]} here as ${entity.type} #${id}.` }),
      };
    }),
  };
}

let lastType: EntityType = "item";

export function InsertReference(props: { field: FieldText }) {
  const [selection, setSelection] = useState<[number, number] | null>(null);
  return (
    <>
      <IconButton
        icon="link"
        label="Insert reference"
        description="Insert an item, quest, NPC, spell, or object at the caret"
        aria-haspopup="dialog"
        onClick={() => setSelection(props.field.selection())}
      />
      {selection && <ReferencePicker field={props.field} selection={selection} onClose={() => setSelection(null)} />}
    </>
  );
}

function ReferencePicker(props: { field: FieldText; selection: [number, number]; onClose: () => void }) {
  const { field, selection, onClose } = props;
  const names = useEntityNames();
  const [type, setType] = useState(lastType);
  const [query, setQuery] = useState(() => field.text.slice(...selection).trim());
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const found = (query.trim() && names.search(type, query, LIMIT)) || [];
  const current = found.length > 0 ? Math.min(active, found.length - 1) : -1;

  const insert = (entity: Entity) => {
    try {
      return insertEntityReference(field.text, ...selection, { type: entity.type, id: entity.id, label: entity.name });
    } catch {
      return null;
    }
  };
  const result = current >= 0 ? insert(found[current]!) : null;
  const choose = (entity: Entity) => {
    const inserted = insert(entity);
    if (!inserted) return setError(`“${entity.name}” cannot be written as a reference in guide text.`);
    lastType = type;
    field.replace(inserted.text, inserted.caret);
    onClose();
  };

  const listId = `${id}-options`;
  const status = names.status(type) ?? (query.trim() ? "No matches." : "Type a name or ID.");
  return (
    <Dialog title="Insert reference" onClose={onClose} className="reference-picker">
      <Segmented
        label="Type"
        size={32}
        value={type}
        options={ENTITY_TYPES.map((t) => ({ value: t, label: TYPE_NAMES[t] }))}
        onChange={(t) => {
          setType(t);
          setActive(0);
          setError(null);
        }}
      />
      <Field label={`${TYPE_NAMES[type]} name or ID`} layout="stacked">
        <Input
          size={32}
          data-autofocus
          value={query}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={found.length > 0}
          aria-controls={found.length > 0 ? listId : undefined}
          aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setError(null);
          }}
          onKeyDown={(e) => {
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && found.length > 0) {
              e.preventDefault();
              setActive(moveActive(e.key, current, found.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (current >= 0) choose(found[current]!);
            }
          }}
        />
      </Field>
      {found.length > 0 ? (
        <OptionList
          id={listId}
          label={`${TYPE_NAMES[type]} results`}
          options={found.map((entity) => ({ key: String(entity.id), label: <EntityOption entity={entity} /> }))}
          active={current}
          onChoose={(i) => choose(found[i]!)}
        />
      ) : (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {result && (
        <p className="shows-as">
          <span className="muted">Shows as:</span>{" "}
          <GuideText parts={guideText(result.text, (type, id) => names.lookup(type, id)?.name)} links="entity" />
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="primary" size={32} disabled={current < 0} onClick={() => choose(found[current]!)}>
          Insert
        </Button>
      </div>
    </Dialog>
  );
}
