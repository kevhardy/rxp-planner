import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons.tsx";

/**
 * `children` is one short line that names the next step, not the state, such
 * as "Import a guide". `action` holds the buttons for that step.
 */
export function EmptyState(props: {
  title: ReactNode;
  children: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={props.className ? `ui-empty ${props.className}` : "ui-empty"}>
      {props.icon && <Icon name={props.icon} size={24} className="ui-empty-icon" />}
      <p className="ui-empty-title">{props.title}</p>
      <p className="ui-empty-line">{props.children}</p>
      {props.action && <div className="ui-empty-action">{props.action}</div>}
    </div>
  );
}
