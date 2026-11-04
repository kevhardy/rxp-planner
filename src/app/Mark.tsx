import { MARKS, type MarkRef, type MarkSpec } from "../rules/index.ts";
import { useGuideIcons } from "./context.ts";
import { iconLook } from "./guideIcon.ts";
import { GuideIcon } from "./GuideText.tsx";
import { MarkShape } from "./markShapes.tsx";

const BOX = { width: 16, height: 16 };
// An inventory icon's dark frame falls outside the 16 px box.
const FRAMED = { width: 19, height: 19 };

export function Mark({ mark }: { mark: MarkRef }) {
  const catalog = useGuideIcons();
  if ("icon" in mark) {
    const { key } = mark.icon.texture;
    const look = iconLook(catalog, key, BOX);
    return (
      <span className="mk tex">
        <GuideIcon look={look} role="img" aria-label={catalog.get(key)?.name ?? `Icon ${mark.icon.written}`} />
      </span>
    );
  }
  const spec: MarkSpec = MARKS[mark.kind];
  const look = iconLook(catalog, spec.texture, spec.framed ? FRAMED : BOX);
  if (!look.drawn) {
    return (
      <span className={`mk mk-${mark.kind}`} aria-hidden="true">
        <MarkShape kind={mark.kind} />
      </span>
    );
  }
  return (
    <span className={`mk mk-${mark.kind} ${spec.framed ? "item" : "tex"}`} aria-hidden="true">
      <GuideIcon look={look} />
    </span>
  );
}
