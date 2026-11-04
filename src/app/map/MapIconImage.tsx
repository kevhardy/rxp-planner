import { useContext } from "react";
import { DatasetContext } from "../context.ts";

export function MapIconImage(props: { icon: string | undefined; size?: number; className?: string }) {
  const data = useContext(DatasetContext)?.data;
  const { size = 20 } = props;
  const icons = data?.manifest.icons;
  const icon = props.icon !== undefined && icons && Object.hasOwn(icons, props.icon) ? icons[props.icon] : undefined;
  const source = icon && data ? `${data.base}${icon.file}` : "";
  const image = data?.imageUrls?.get(source) ?? source;
  const f = size / 24;
  return (
    <span
      className={`map-icon${props.className ? ` ${props.className}` : ""}`}
      style={{
        "--size": `${size}px`,
        "--image": icon && `url("${image.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`,
        "--image-x": icon && `${icon.x * f}px`,
        "--image-y": icon && `${icon.y * f}px`,
        "--image-w": icon && `${icon.width * f}px`,
      }}
      aria-hidden="true"
    />
  );
}
