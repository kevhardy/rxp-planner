import { useState } from "react";
import { BUILTIN_SECTION, BuiltinSection } from "./BuiltinGuides.tsx";
import { useEditor } from "./context.ts";
import { ImportGuideButton } from "./ImportDialog.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";

export function StartPane(props: { libraryOpen: boolean }) {
  const { builtins, guides } = useEditor();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([BUILTIN_SECTION]));
  const yours = guides.size > 0;
  const line =
    builtins.size > 0
      ? `Choose a RestedXP guide below, or ${yours ? "open one of yours from the Library" : "import your own"}.`
      : yours
        ? "Open one of your guides from the Library, or import one."
        : "Import a guide to start.";
  return (
    <section
      className="region-steps panel"
      data-region="steps"
      aria-label="Steps"
      inert={props.libraryOpen}
      aria-hidden={props.libraryOpen || undefined}
    >
      <div className="panel-head">
        <h2>Steps</h2>
      </div>
      <div className="panel-body lib" data-tip-bounds>
        <EmptyState title="Open a guide to start" action={<ImportGuideButton />}>
          {line}
        </EmptyState>
        <BuiltinSection
          expanded={expanded}
          onToggle={(key) =>
            setExpanded((set) => {
              const next = new Set(set);
              if (!next.delete(key)) next.add(key);
              return next;
            })
          }
          currentId={undefined}
        />
      </div>
    </section>
  );
}
