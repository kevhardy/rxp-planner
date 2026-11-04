import type { HTMLAttributes, ReactNode } from "react";
import { isColorRun, isMono, isTexture, type RxpColor, type TextPart } from "../guide/index.ts";
import { useGuideIcons } from "./context.ts";
import { EntityLink } from "./EntityLink.tsx";
import { textureIcon, type IconLook } from "./guideIcon.ts";
import { Mono } from "./ui/Text.tsx";

/**
 * Guide text as `guideText` gives it, read only. Each texture shows as its
 * icon, named by its catalog name, and colored text in its RXP color.
 * `links="entity"` links each entity reference; inside a button or an
 * option, `links="plain"` shows its text.
 */
export function GuideText(props: { parts: readonly TextPart[]; links: "plain" | "entity" }) {
  const catalog = useGuideIcons();
  return props.parts.map((part, i) => {
    if (typeof part === "string") return part;
    if (isTexture(part)) {
      const { name, look } = textureIcon(catalog, part.texture, part.written);
      return <GuideIcon key={i} look={look} role="img" aria-label={name} />;
    }
    if (isColorRun(part)) return <Colored key={i} color={part.color} content={part.text} />;
    if (isMono(part)) return <Mono key={i}>{part.mono}</Mono>;
    const content =
      props.links === "entity" ? (
        <EntityLink key={i} type={part.type} id={part.id}>
          {part.text}
        </EntityLink>
      ) : (
        part.text
      );
    return part.color ? <Colored key={i} color={part.color} content={content} /> : content;
  });
}

export function GuideIcon({
  look,
  ...rest
}: { look: IconLook } & Pick<HTMLAttributes<HTMLSpanElement>, "role" | "aria-label" | "aria-hidden">) {
  const { vars } = look;
  return (
    <span
      {...rest}
      className={look.className}
      style={{
        "--icon-w": vars["--icon-w"],
        "--icon-h": vars["--icon-h"],
        "--icon-ratio": vars["--icon-ratio"],
        "--sheet-w": vars["--sheet-w"],
        "--sheet-h": vars["--sheet-h"],
        "--cell-x": vars["--cell-x"],
        "--cell-y": vars["--cell-y"],
        "--icon-url": vars["--icon-url"],
      }}
    />
  );
}

function Colored(props: { color: RxpColor; content: ReactNode }) {
  return (
    <span className="rxp-colored" data-color={props.color}>
      {props.content}
    </span>
  );
}
