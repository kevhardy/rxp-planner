const PATHS = {
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2 2l12 12" />
      <path d="M6.5 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.3M4.3 4.8C2.6 6 1.5 8 1.5 8S4 12.5 8 12.5a6 6 0 0 0 3.2-.9" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" />,
  up: <path d="M8 13V3M4 7l4-4 4 4" />,
  down: <path d="M8 3v10M4 9l4 4 4-4" />,
  upToBar: <path d="M3.5 2.5h9M8 14V6M4.5 9.5 8 6l3.5 3.5" />,
  chevronLeft: <path d="m10 3-5 5 5 5" />,
  chevronRight: <path d="m6 3 5 5-5 5" />,
  chevronDown: <path d="m3 6 5 5 5-5" />,
  x: <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />,
  check: <path d="m3 8.5 3.5 3.5L13 4.5" />,
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </>
  ),
  moon: <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
  library: (
    <>
      <path d="M3 2.5h8.5a1 1 0 0 1 1 1V13H4a1 1 0 0 1-1-1z" />
      <path d="M3 11h9.5M6 5h4" />
    </>
  ),
  folder: (
    <>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" />
      <path d="M8 7.5v4M6 9.5h4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  zoomIn: <path d="M8 4.5v7M4.5 8h7" />,
  zoomOut: <path d="M4.5 8h7" />,
  fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  import: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />,
  export: <path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />,
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.75.75M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />,
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />,
  user: (
    <>
      <circle cx="8" cy="5.5" r="3" />
      <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  pin: (
    <>
      <path d="M8 14s4-4.2 4-7.5a4 4 0 0 0-8 0C4 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.4" />
    </>
  ),
  sliders: <path d="M2.5 4.5h11M2.5 11.5h11M10.5 2.5v4M5.5 9.5v4" />,
  route: (
    <>
      <circle cx="3.5" cy="12.5" r="1.5" />
      <circle cx="12.5" cy="3.5" r="1.5" />
      <path d="M5 12.5h4a2.5 2.5 0 0 0 0-5H7a2.5 2.5 0 0 1 0-5h4" />
    </>
  ),
  ship: (
    <>
      <path d="M2 10h12l-1.8 3.5H3.8z" />
      <path d="M8 10V2l4.5 6H8" />
    </>
  ),
  zeppelin: (
    <>
      <ellipse cx="7" cy="6" rx="5.5" ry="3.2" />
      <path d="M5.5 9.2v2.3h3V9.2M12.5 6l2-2.5v5z" />
    </>
  ),
  tram: (
    <>
      <rect x="3.5" y="2" width="9" height="9.5" rx="2" />
      <path d="M3.5 7h9M6 9.3h.01M10 9.3h.01M5.5 11.5 4 14M10.5 11.5 12 14" />
    </>
  ),
  portal: (
    <>
      <ellipse cx="8" cy="8" rx="4.5" ry="6" />
      <path d="M8 5.5a2 2.5 0 1 1-2 2.5" />
    </>
  ),
  elevator: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1" />
      <path d="m6 6.5 2-2 2 2M6 9.5l2 2 2-2" />
    </>
  ),
  door: <path d="M4 14V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v11M2.5 14h11M9.5 8.5v.01" />,
  bird: <path d="M1.5 6c2.5 0 4.5 1.5 6.5 4.5 2-3 4-4.5 6.5-4.5" />,
  flight: (
    <>
      <path d="M2 14c1.8-4 4.5-6.5 8-7.5" strokeDasharray="1 2.5" />
      <path d="M8.5 3.5c1.5 0 2.7.8 3.5 2 .8-1.2 2-2 3.5-2" />
    </>
  ),
  warning: <path d="M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5v.01" />,
  play: <path d="M5 3.2v9.6L12.8 8z" />,
  pen: <path d="M3 13l1-3.5 6.5-6.5 2.5 2.5L6.5 12z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  skipBack: <path d="M3.5 3.5v9M12.5 3.5 6 8l6.5 4.5z" />,
  skipForward: <path d="M12.5 3.5v9M3.5 3.5 10 8l-6.5 4.5z" />,
  image: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="m2.5 11 3.5-3.5 3 3 2-2 2.5 2.5M10.5 5.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5V11M8 5v.01" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

/** A 16px icon in the current text colour; `size` 12 for the small set. */
export function Icon(props: { name: IconName; size?: number; className?: string }) {
  const size = props.size ?? 16;
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[props.name]}
    </svg>
  );
}

export function WarningMark() {
  return (
    <svg width={14} height={12} viewBox="0 0 14 12" aria-hidden="true" fill="currentColor" fillRule="evenodd">
      <path d="M6.23.73a.9.9 0 0 1 1.54 0l5.8 9.6a.9.9 0 0 1-.77 1.37H1.2a.9.9 0 0 1-.77-1.37zM7 3.8a.9.9 0 0 1 .9.9v1.8a.9.9 0 0 1-1.8 0V4.7a.9.9 0 0 1 .9-.9zm0 4.25a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9z" />
    </svg>
  );
}
