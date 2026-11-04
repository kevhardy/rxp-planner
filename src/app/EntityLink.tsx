import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Entity, EntityIndex, EntityType, GameData } from "../data/index.ts";
import type { Status } from "./async.ts";
import { useEntities, useEntitiesFailed, useGameData } from "./context.ts";
import { Described } from "./Described.tsx";
import { useAssets, useRetain } from "./effects.ts";
import { wowhead } from "./wowhead.ts";

export interface EntityNames {
  /** The entity, `undefined` when its source lacks it, or `null` while the source loads. */
  lookup(type: EntityType, id: number): Entity | undefined | null;
  /** Matches by name or ID, ranked as `EntityIndex.search` ranks them, or `null` while the source loads. */
  search(type: EntityType, query: string, limit: number): readonly Entity[] | null;
  status(type: EntityType, manualQuestId?: boolean): string | undefined;
}

export function useEntityNames(): EntityNames {
  const entities = useEntities();
  const failed = useEntitiesFailed();
  const data = useGameData();
  return useMemo(() => entityNames(entities, failed, data), [entities, failed, data]);
}

/** The names of the loaded sources. `null` means a source still loads; `failed` means the index failed to load. */
export function entityNames(entities: EntityIndex | null, failed: boolean, data: GameData | null): EntityNames {
  const asEntity = (quest: { id: number; name: string }): Entity => ({ type: "quest", id: quest.id, name: quest.name });
  return {
    lookup(type, id) {
      if (type !== "quest") return entities && entities.lookup(type, id);
      const quest = data && data.quest(id);
      return quest && asEntity(quest);
    },
    search(type, query, limit) {
      if (type !== "quest") return entities && entities.search(type, query, limit);
      if (!data) return null;
      const key = query.trim().toLowerCase();
      if (!key) return [];
      const name = (q: { name: string }) => q.name.toLowerCase();
      const rank = (q: { id: number; name: string }) => (String(q.id) === key ? 0 : name(q) === key ? 1 : name(q).startsWith(key) ? 2 : 3);
      return data
        .searchQuests({ text: key })
        .sort((a, b) => rank(a) - rank(b) || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0) || a.id - b.id)
        .slice(0, limit)
        .map(asEntity);
    },
    status(type, manualQuestId = false) {
      if (type === "quest")
        return data ? undefined : failed ? `Quest data unavailable.${manualQuestId ? " Enter an ID." : ""}` : "Loading quest data…";
      if (entities) return undefined;
      return failed ? "Names failed to load. Enter an ID." : "Loading names…";
    },
  };
}

/*
 * Links to game entities on the selected Wowhead edition.
 *
 *   <EntityLink type="item" id={6948} />      // "Hearthstone"
 *
 * The link shows the entity's name from `useEntityNames`, with a spell's
 * rank, else `name`, else `item #6948`. Wowhead's tooltip script adds rich
 * details on hover once it loads; it leaves the link's text alone. Keyboard
 * focus shows a short description instead, since the script ignores focus,
 * and hover shows it while the script is missing. Either way the link works.
 */

function useTooltipsStatus(): Status<void>["kind"] {
  useRetain(wowhead, "tooltips");
  return useSyncExternalStore(wowhead.subscribe, wowhead.getState);
}

function wowheadUrl(type: EntityType, id: number): string {
  return `https://www.wowhead.com/forever/${type}=${id}`;
}

/**
 * A link to an entity on Wowhead. `name` is the fallback when the
 * entity's source lacks it; `children` replace the shown name. `menuItem`
 * makes it an item of a menu that moves focus between its items. An ID that
 * is not a positive integer renders as text.
 */
export function EntityLink(props: {
  type: EntityType;
  id: number;
  name?: string | undefined;
  className?: string;
  menuItem?: boolean;
  children?: ReactNode;
}) {
  const { type, id } = props;
  const found = useEntityNames().lookup(type, id);
  const ready = useTooltipsStatus() === "ready";
  const entity = found ?? undefined;
  const name = entity?.name ?? props.name;
  const text = props.children ?? (
    <>
      {name ?? `${type} #${id}`}
      {entity?.subtext && (
        <>
          {" "}
          <span className="entity-sub">{entity.subtext}</span>
        </>
      )}
    </>
  );
  if (!Number.isSafeInteger(id) || id <= 0) return <span className={props.className}>{text}</span>;
  const known = name ? `${name}${entity?.subtext ? ` (${entity.subtext})` : ""} · ` : "";
  const missing = found === undefined ? ", not in the bundled data" : "";
  return (
    <Described text={`${known}${type} ${id}${missing}. Opens on Wowhead.`} hover={!ready}>
      <a
        className={`entity-link${props.className ? ` ${props.className}` : ""}`}
        href={wowheadUrl(type, id)}
        target="_blank"
        rel="noreferrer"
        {...(props.menuItem && { role: "menuitem", tabIndex: -1 })}
        // The script reads `rel` as its options unless this is set.
        data-wowhead="domain=forever"
      >
        {text}
      </a>
    </Described>
  );
}

const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/medium/${encodeURIComponent(icon)}.jpg`;

/**
 * An item as its Wowhead icon, a link like `EntityLink` whose tooltip shows
 * on hover. `count` above one shows on the icon's corner, or after the name
 * when `named` adds the item's name beside it; `name` is the fallback when the
 * entity's source lacks it, as for `EntityLink`. A question mark stands in until the icon arrives,
 * and the plain link replaces it when Wowhead's script cannot load.
 *
 *   <ItemIcon id={159} count={5} />       // icon with "5" on its corner
 */
export function ItemIcon(props: { id: number; count?: number; named?: boolean; name?: string }) {
  const { id, count = 1 } = props;
  const tooltips = useTooltipsStatus();
  const [asked] = useAssets(
    wowhead.icons,
    useMemo(() => [id], [id]),
  );
  const icon = asked?.kind === "ready" ? asked.value : null;
  const name = useEntityNames().lookup("item", id)?.name ?? props.name ?? `item #${id}`;
  const counted = count > 1 ? `${name} ×${count}` : name;
  if (tooltips === "failed")
    return (
      <>
        <EntityLink type="item" id={id} name={props.name} />
        {count > 1 && ` ×${count}`}
      </>
    );
  return (
    <EntityLink type="item" id={id} name={props.name} className="item-icon">
      <span className="item-icon-image">
        <img src={iconUrl(icon ?? "inv_misc_questionmark")} alt={props.named ? "" : counted} width={20} height={20} />
        {count > 1 && !props.named && <span aria-hidden="true">{count}</span>}
      </span>
      {props.named && counted}
    </EntityLink>
  );
}
