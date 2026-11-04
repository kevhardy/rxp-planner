import { useContext } from "react";
import { DatasetContext } from "../context.ts";

/** Without `size`, the icon takes its size from CSS. */
export function MapIconImage(props: { icon: string | undefined; size?: number; className?: string }) {
  const data = useContext(DatasetContext)?.data;
  const icons = data?.manifest.icons;
  const icon = props.icon !== undefined && icons && Object.hasOwn(icons, props.icon) ? icons[props.icon] : undefined;
  const source = icon && data ? `${data.base}${icon.file}` : "";
  const image = data?.imageUrls?.get(source) ?? source;
  return (
    <span
      className={`map-icon${props.className ? ` ${props.className}` : ""}`}
      style={{
        "--size": props.size && `${props.size}px`,
        "--image": icon && `url("${image.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`,
        "--image-x": icon?.x,
        "--image-y": icon?.y,
        "--image-w": icon?.width,
      }}
      aria-hidden="true"
    />
  );
}
