import { useEffect, useMemo, useRef, useState } from "react";
import type { GuideDocument } from "../guide/index.ts";
import { Described } from "./Described.tsx";
import { useTimeout } from "./effects.ts";
import { Icon } from "./icons.tsx";
import { sectionRange } from "./sections.ts";
import { Button } from "./ui/Button.tsx";

export function GuideSource(props: { text: string; doc: GuideDocument; step: number | null }) {
  const { text, doc, step } = props;
  const lines = useMemo(() => {
    const all = text.split(/\r\n|\r|\n/);
    return doc.finalNewline ? all.slice(0, -1) : all;
  }, [text, doc.finalNewline]);
  const [start, end] = sectionRange(doc, step);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    ref.current?.querySelector(".hl")?.scrollIntoView?.({ block: "center" });
  }, [start]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users scroll the text from here.
    <pre ref={ref} className="guide-text mono" role="region" tabIndex={0} aria-label="Guide text, read only">
      {lines.map((line, i) => (
        <span key={i} className={i >= start && i < end ? "ln hl" : "ln"}>
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export function CopyTextButton(props: { text: string }) {
  const [status, setStatus] = useState<string | null>(null);
  useTimeout(() => setStatus(null), status ? 2000 : null, status);
  return (
    <>
      <Described text="Copy the guide text for RXP's import window">
        <Button
          variant="secondary"
          onClick={() => {
            // `navigator.clipboard` is missing outside secure contexts.
            Promise.resolve()
              .then(() => navigator.clipboard.writeText(props.text))
              .then(() => setStatus("Copied"))
              .catch((error: unknown) => setStatus(`Copy failed: ${error instanceof Error ? error.message : String(error)}`));
          }}
        >
          <Icon name="copy" />
          Copy guide text
        </Button>
      </Described>
      <span className="status" role="status">
        {status}
      </span>
    </>
  );
}
