import { createElement, type ReactNode } from "react";

export type TypeStep = "small" | "body" | "pane-title" | "title";

export type Tone = "muted";

export function Heading(props: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  size: TypeStep;
  tone?: Tone;
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return createElement(
    `h${props.level}`,
    {
      id: props.id,
      className: props.className ? `ui-heading ${props.className}` : "ui-heading",
      "data-size": props.size,
      "data-tone": props.tone,
    },
    props.children,
  );
}

/** Without `size` it keeps the size around it. */
export function Text(props: {
  as?: "span" | "p" | "div";
  size?: TypeStep;
  tone?: Tone;
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return createElement(
    props.as ?? "span",
    {
      id: props.id,
      className: props.className ? `ui-text ${props.className}` : "ui-text",
      "data-size": props.size,
      "data-tone": props.tone,
    },
    props.children,
  );
}

export function Mono(props: { children: ReactNode }) {
  return <span className="ui-mono">{props.children}</span>;
}
