import { checkExamples } from "../examples.ts";
import rule from "./no-raw-color.ts";

checkExamples("no-raw-color", rule, [
  { name: "C01", code: 'const ink = "#1f1d1a";', reports: [['"#1f1d1a"', 13]] },
  { name: "C02", code: "const ink = '#FFF';", reports: [["'#FFF'", 13]] },
  { name: "C03", code: 'const ring = "0 0 0 1px #0008";', reports: [['"0 0 0 1px #0008"', 14]] },
  { name: "C04", code: 'const ink = "#1f1d1a80";', reports: [['"#1f1d1a80"', 13]] },
  { name: "C05", code: 'const fill = "rgb(31 29 26)";', reports: [['"rgb(31 29 26)"', 14]] },
  { name: "C06", code: 'const fill = "RGBA(0, 0, 0, 0.5)";', reports: [['"RGBA(0, 0, 0, 0.5)"', 14]] },
  { name: "C07", code: 'const fill = "hsl(30 10% 12%)";', reports: [['"hsl(30 10% 12%)"', 14]] },
  { name: "C08", code: "const fill = `hsla(${hue}, 50%, 50%, 1)`;", reports: [["`hsla(${", 14]] },
  { name: "C09", code: "const fill = `rgb(${r} ${g} ${b})`;", reports: [["`rgb(${", 14]] },
  { name: "C10", code: "const halo = `0 0 0 ${width}px #fff`;", reports: [["}px #fff`", 28]] },
  {
    name: "C11",
    code: 'const logo = <circle fill="#fff" />;',
    reports: [['"#fff"', 27]],
    tsx: true,
  },
  {
    name: "C12",
    code: 'const swatch = <span style={{ background: "#22d3ee" }} />;',
    reports: [['"#22d3ee"', 43]],
    tsx: true,
  },
  { name: "C13", code: 'const fill = "var(--text)";' },
  { name: "C14", code: "const fill = `var(--objective-${n})`;" },
  { name: "C15", code: 'const label = "npc #" + id; const link = `item #${id}`;' },
  { name: "C16", code: 'const anchor = "#steps"; const tag = "#group"; const big = "#1234567";' },
  { name: "C17", code: 'const id = "#fff-row"; const issue = "issue#123";' },
  { name: "C18", code: 'const word = "background"; const call = "argb(1)";' },
  { name: "C19", code: "class Store { #add() {} }" },
  { name: "C20", code: "const text = <p>Use #fff here</p>;", tsx: true },
  { name: "C21", code: "const pattern = /#[\\da-f]{6}/;" },
  { name: "C22", code: "const ink = `\\x23fff`;", reports: [["`\\x23fff`", 13]] },
  {
    name: "C23",
    code: 'const a = "color(srgb 1 0 0)"; const b = "COLOR(display-p3 1 0 0)";',
    reports: [
      ['"color(srgb 1 0 0)"', 11],
      ['"COLOR(display-p3 1 0 0)"', 42],
    ],
  },
  {
    name: "C24",
    code: 'const a = "lab(50 0 0)"; const b = "LCH(50 0 0)";',
    reports: [
      ['"lab(50 0 0)"', 11],
      ['"LCH(50 0 0)"', 36],
    ],
  },
  {
    name: "C25",
    code: 'const a = "oklab(0.5 0 0)"; const b = "OkLch(0.5 0.1 20)";',
    reports: [
      ['"oklab(0.5 0 0)"', 11],
      ['"OkLch(0.5 0.1 20)"', 39],
    ],
  },
  {
    name: "C26",
    code: 'const a = "hwb(0 0% 0%)"; const b = "Device-CMYK(0 0 0 1)";',
    reports: [
      ['"hwb(0 0% 0%)"', 11],
      ['"Device-CMYK(0 0 0 1)"', 37],
    ],
  },
  {
    name: "C27",
    code: 'const a = <path fill="white" stroke="Black" color="red" stopColor="navy" floodColor={"gold"} lightingColor={`tan`} />;',
    reports: [
      ['"white"', 22],
      ['"Black"', 37],
      ['"red"', 51],
      ['"navy"', 67],
      ['"gold"', 86],
      ["`tan`", 109],
    ],
    tsx: true,
  },
  {
    name: "C28",
    code: 'const a = <span style={{ color: "red", backgroundColor: "White", border: "1px solid black", "box-shadow": "0 0 2px gray" }} />;',
    reports: [
      ['"red"', 33],
      ['"White"', 57],
      ['"1px solid black"', 74],
      ['"0 0 2px gray"', 107],
    ],
    tsx: true,
  },
  {
    name: "C29",
    code: 'const a = <path fill="none" stroke="currentColor" color="var(--text)" style={{ display: "block", color: "inherit", fontFamily: "Black Ops" }} />;',
    tsx: true,
  },
  { name: "C30", code: 'const label = "White Wolf"; const b = <p title="Red Ridge">red</p>;', tsx: true },
  {
    name: "C31",
    code: 'const ink = "white"; const a = <path fill={ink} stroke={ink} />;',
    reports: [['"white"', 13]],
    tsx: true,
  },
  {
    name: "C32",
    code: 'const ink = "var(--text)"; const a = <path fill={ink} color={props.color} />;',
    tsx: true,
  },
  {
    name: "C33",
    code: 'let ink = "white"; const a = <path fill={ink} />;',
    reports: [['"white"', 11]],
    tsx: true,
  },
  {
    name: "C34",
    code: 'const colors = { ink: "white" }; const a = <path fill={colors.ink} />;',
    reports: [['"white"', 23]],
    tsx: true,
  },
  { name: "C35", code: 'export const INK = "white";', reports: [['"white"', 20]] },
  { name: "C36", code: "const ink = `white`;", reports: [["`white`", 13]] },
  {
    name: "C37",
    code: 'const a = "gray-text"; const b = "Gold Dust"; const c = <p className="gold-coin">gold coins</p>;',
    tsx: true,
  },
  { name: "C38", code: 'const label = "Gold";' },
  // CSS ignores the spaces around a value, so the padded keyword still paints white.
  {
    name: "C39",
    code: 'const ink = " white "; const a = <path fill={ink} stroke=" white " />;',
    reports: [
      ['" white "', 13],
      ['" white "', 58],
    ],
    tsx: true,
  },
  {
    name: "C34",
    code: 'const fill = "red"; const area = <g style={{ "--fill": fill }} />;',
    reports: [['"red"', 14]],
    tsx: true,
  },
  {
    name: "C35",
    code: 'const pin = <Card vars={{ "--fill": "gold" }} />;',
    reports: [['"gold"', 37]],
    tsx: true,
  },
]);
