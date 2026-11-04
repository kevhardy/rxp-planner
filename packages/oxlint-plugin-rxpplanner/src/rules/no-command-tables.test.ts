import { checkExamples } from "../examples.ts";
import rule from "./no-command-tables.ts";

checkExamples("no-command-tables", rule, [
  { name: "C01", code: 'new Set(["goto", "waypoint"]);', reports: [['new Set(["goto", "waypoint"])', 1]] },
  { name: "C02", code: 'new Map([["goto", 1], ["waypoint", 2]]);', reports: [['new Map([["goto", 1], ["waypoint", 2]])', 1]] },
  { name: "C03", code: "const rows = { accept: 1, turnin: 2 };", reports: [["{ accept: 1, turnin: 2 }", 14]] },
  { name: "C04", code: 'const rows = { "goto": 1, "waypoint": 2 };', reports: [['{ "goto": 1, "waypoint": 2 }', 14]] },
  { name: "C05", code: "const run = { goto() {}, waypoint() {} };", reports: [["{ goto() {}, waypoint() {} }", 13]] },
  { name: "C06", code: 'new Set<string>(["accept", "turnin"]);', reports: [['new Set<string>(["accept", "turnin"])', 1]] },
  { name: "C07", code: 'new Set(["goto"]);' },
  { name: "C08", code: 'new Set(["goto", "north"]);' },
  { name: "C09", code: 'new Set(["north", "south"]);' },
  { name: "C10", code: 'new Map([["north", 1], ["goto", 2]]);' },
  { name: "C11", code: 'const menu = ["goto", "waypoint"];' },
  { name: "C12", code: "const rows = { [kind]: 1, turnin: 2 };" },
  { name: "C13", code: "const rows = { accept: 1, ...rest };" },
  { name: "C14", code: "const picked = { accept, turnin };" },
  { name: "C15", code: "new Set(names);" },
  { name: "C16", code: 'new List(["goto", "waypoint"]);' },
  { name: "C17", code: 'new Set(["goto", "waypoint"] as const);', reports: [['new Set(["goto", "waypoint"] as const)', 1]] },
  {
    name: "C18",
    code: 'new Set(["goto", "waypoint"] satisfies readonly string[]);',
    reports: [['new Set(["goto", "waypoint"] satisfies readonly string[])', 1]],
  },
  {
    name: "C19",
    code: 'new Map([["goto", 1] as const, ["waypoint", 2] as const]);',
    reports: [['new Map([["goto", 1] as const, ["waypoint", 2] as const])', 1]],
  },
  {
    name: "C20",
    code: 'new Set(["goto" as const, "waypoint" as const]);',
    reports: [['new Set(["goto" as const, "waypoint" as const])', 1]],
  },
  { name: "C21", code: 'new Set(["goto", "north"] as const);' },
]);
