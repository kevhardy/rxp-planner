import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { ControlSize } from "./Button.tsx";
import { Described } from "../Described.tsx";
import { Icon } from "../icons.tsx";

interface Wiring {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldWiring = createContext<Wiring | null>(null);

function ids(...lists: Array<string | undefined>): string | undefined {
  return lists.filter(Boolean).join(" ") || undefined;
}

function useWiring(own: {
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: InputHTMLAttributes<HTMLElement>["aria-invalid"];
}) {
  const field = useContext(FieldWiring);
  if (!field) return {};
  return {
    id: field.id,
    "aria-describedby": ids(field.describedBy, own["aria-describedby"]),
    "aria-invalid": field.invalid || own["aria-invalid"] || undefined,
  };
}

const placed = (base: string, className: string | undefined) => (className ? `${base} ${className}` : base);

/**
 * The `Input`, `Select`, or `TextArea` inside takes its `id`,
 * `aria-describedby`, and `aria-invalid` from the field.
 *
 * - `hideLabel`: the hidden label stays the accessible name.
 * - `id`: the control's id, for a reference from outside the field.
 * - `description`: the tooltip.
 * - `popoverOpen`: true while a list that the control opened is open, which
 *   hides the tooltip.
 */
export function Field(props: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  layout?: "inline" | "stacked";
  hideLabel?: boolean;
  id?: string | undefined;
  description?: string | undefined;
  popoverOpen?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  const own = useId();
  const id = props.id ?? own;
  const hint = props.hint !== undefined && props.hint !== null && props.hint !== "";
  const error = props.error !== undefined && props.error !== null && props.error !== "";
  const wiring: Wiring = {
    id,
    describedBy: ids(hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined),
    invalid: error,
  };
  return (
    <Described text={props.description} popoverOpen={props.popoverOpen ?? false}>
      <span className={placed("ui-field", props.className)} data-layout={props.layout ?? "inline"}>
        <label htmlFor={id} className={props.hideLabel ? "sr-only" : "ui-field-label"}>
          {props.label}
        </label>
        <FieldWiring.Provider value={wiring}>{props.children}</FieldWiring.Provider>
        {hint && (
          <span id={`${id}-hint`} className="ui-field-hint">
            {props.hint}
          </span>
        )}
        {error && (
          <span id={`${id}-error`} className="ui-field-error" role="alert">
            {props.error}
          </span>
        )}
      </span>
    </Described>
  );
}

type Native<A> = Omit<A, "style" | "size" | "type" | "children" | "className"> & { className?: string | undefined; style?: never };

/** Inside a `Field` the field names it; outside one it needs an `aria-label`. */
export function Input(
  props: Native<InputHTMLAttributes<HTMLInputElement>> & {
    type?: "text" | "number" | "search";
    size?: ControlSize;
    mono?: boolean;
    ref?: Ref<HTMLInputElement>;
  },
) {
  const { type = "text", size = 24, mono, className, ...rest } = props;
  return (
    <input
      {...rest}
      {...useWiring(rest)}
      type={type}
      className={placed("ui-input", className)}
      data-size={size}
      data-mono={mono || undefined}
    />
  );
}

/** `className` places the box around the select. */
export function Select(
  props: Native<SelectHTMLAttributes<HTMLSelectElement>> & {
    size?: ControlSize;
    ref?: Ref<HTMLSelectElement>;
    children: ReactNode;
  },
) {
  const { size = 24, className, children, ...rest } = props;
  return (
    <span className={placed("ui-select", className)} data-size={size}>
      <select {...rest} {...useWiring(rest)}>
        {children}
      </select>
      <Icon name="chevronDown" size={12} />
    </span>
  );
}

export function TextArea(props: Native<TextareaHTMLAttributes<HTMLTextAreaElement>> & { ref?: Ref<HTMLTextAreaElement> }) {
  const { className, ...rest } = props;
  return <textarea {...rest} {...useWiring(rest)} className={placed("ui-textarea", className)} />;
}

export function Slider(props: Native<InputHTMLAttributes<HTMLInputElement>> & { ref?: Ref<HTMLInputElement> }) {
  const { className, ...rest } = props;
  return <input {...rest} type="range" className={placed("ui-slider", className)} />;
}

export function FileInput(
  props: Omit<Native<InputHTMLAttributes<HTMLInputElement>>, "hidden" | "className"> & { ref?: Ref<HTMLInputElement> },
) {
  return <input {...props} type="file" hidden />;
}
