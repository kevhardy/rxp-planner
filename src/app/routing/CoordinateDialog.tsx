import { useState } from "react";
import type { WorldPoint } from "../../../packages/data-contract/geometry.ts";
import { formatWorldPoint, parseWorldPoint } from "../../routing/plan.ts";
import { Dialog } from "../Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, Input } from "../ui/Field.tsx";

export function CoordinateDialog(props: {
  title: string;
  value: WorldPoint | undefined;
  onApply: (p: WorldPoint) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(props.value ? formatWorldPoint(props.value) : "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            props.onApply(parseWorldPoint(text));
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }}
      >
        <Field label="World yards (x, y)" error={error} layout="stacked">
          <Input size={32} mono value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" size={32}>
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
