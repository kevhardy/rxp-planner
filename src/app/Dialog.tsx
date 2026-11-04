import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OverlayRoot } from "./overlayRoot.ts";
import { Button, IconButton, type ButtonVariant } from "./ui/Button.tsx";
import { Field, Input } from "./ui/Field.tsx";

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const { title, onClose, children, className } = props;
  const titleId = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("app");
    root?.setAttribute("inert", "");
    dialog.showModal();
    (
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>("input, select, textarea") ??
      closeButton.current
    )?.focus();
    let pressStartedOnBackdrop = false;
    const listening = new AbortController();
    const { signal } = listening;
    dialog.addEventListener(
      "cancel",
      (e) => {
        e.preventDefault();
        closeRef.current();
      },
      { signal },
    );
    dialog.addEventListener(
      "mousedown",
      (e) => {
        pressStartedOnBackdrop = e.target === dialog;
        if (pressStartedOnBackdrop) e.preventDefault();
      },
      { signal },
    );
    dialog.addEventListener(
      "click",
      (e) => {
        if (e.target === dialog && pressStartedOnBackdrop) closeRef.current();
        pressStartedOnBackdrop = false;
      },
      { signal },
    );
    return () => {
      listening.abort();
      dialog.close();
      if (!document.querySelector("dialog[open]")) root?.removeAttribute("inert");
      previous?.focus();
    };
  }, [dialog]);

  return createPortal(
    <dialog ref={setDialog} className="modal" aria-labelledby={titleId}>
      <OverlayRoot value={dialog}>
        <div className={`dialog ${className ?? ""}`}>
          <div className="dialog-title">
            <h2 id={titleId}>{title}</h2>
            <IconButton ref={closeButton} icon="x" label="Close" description="Close (Escape)" size={32} onClick={onClose} />
          </div>
          {children}
        </div>
      </OverlayRoot>
    </dialog>,
    document.body,
  );
}

/** Asks for one value. `onSubmit` returns an error message to keep the dialog open. */
export function PromptDialog(props: {
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (value: string) => string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const message = value.trim() ? props.onSubmit(value.trim()) : "Enter a value.";
          if (message) setError(message);
          else props.onClose();
        }}
      >
        <Field label={props.label} error={error} layout="stacked">
          <Input size={32} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" size={32}>
            {props.submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks to confirm an action. `onConfirm` may return an error message to keep the dialog open. */
export function ConfirmDialog(props: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  confirmVariant?: Extract<ButtonVariant, "primary" | "danger">;
  onConfirm: () => string | null | void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <p>{props.message}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          variant={props.confirmVariant ?? "danger"}
          size={32}
          onClick={() => {
            const message = props.onConfirm();
            if (message) setError(message);
            else props.onClose();
          }}
        >
          {props.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
