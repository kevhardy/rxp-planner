import { useState } from "react";
import { Dialog } from "../Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, TextArea } from "../ui/Field.tsx";

export function CopyRouteDialog(props: { text: string; onClose: () => void }) {
  return (
    <Dialog title="Copy route text" className="route-text-dialog" onClose={props.onClose}>
      <p>The clipboard is not available. Select the text and copy it.</p>
      <Field label="Route text" layout="stacked">
        <TextArea readOnly rows={14} value={props.text} onFocus={(e) => e.target.select()} />
      </Field>
    </Dialog>
  );
}

export function ImportRouteDialog(props: { onImport: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Import route text" className="route-text-dialog" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            props.onImport(text);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }}
      >
        <p>Paste a copied route. It becomes a new route.</p>
        <Field label="Route text" error={error} layout="stacked">
          <TextArea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" size={32}>
            Import
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
