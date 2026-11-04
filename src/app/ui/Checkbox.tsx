import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { Described } from "../Described.tsx";
import { Icon } from "../icons.tsx";

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "style" | "size" | "type" | "children" | "className"> & {
  /** Without a label, the input needs an `aria-label`. */
  label?: ReactNode;
  description?: string | undefined;
  className?: string | undefined;
  style?: never;
  ref?: Ref<HTMLInputElement>;
};

function Choice(props: ChoiceProps & { type: "checkbox" | "radio"; mark: ReactNode }) {
  const { label, description, className, type, mark, ...rest } = props;
  return (
    <Described text={description}>
      <label className={className ? `ui-choice ${className}` : "ui-choice"}>
        <span className="ui-choice-box">
          <input {...rest} type={type} />
          <span className="ui-choice-mark" aria-hidden="true">
            {mark}
          </span>
        </span>
        {label}
      </label>
    </Described>
  );
}

export function Checkbox(props: ChoiceProps & { indeterminate?: boolean }) {
  const { indeterminate = false, ref, ...rest } = props;
  return (
    <Choice
      {...rest}
      type="checkbox"
      mark={<Icon name={indeterminate ? "minus" : "check"} size={12} />}
      ref={(el: HTMLInputElement | null) => {
        if (el) el.indeterminate = indeterminate;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
    />
  );
}

export function Radio(props: ChoiceProps & { name: string }) {
  return <Choice {...props} type="radio" mark={<span className="ui-radio-dot" />} />;
}
