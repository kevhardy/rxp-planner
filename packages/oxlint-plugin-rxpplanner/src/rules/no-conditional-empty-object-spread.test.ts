import { checkExamples } from "../examples.ts";
import rule from "./no-conditional-empty-object-spread.ts";

checkExamples("no-conditional-empty-object-spread", rule, [
  { name: "E01", code: "const record = { ...(ready ? { score: 8 } : {}) };", reports: [["...(ready ? { score: 8 } : {})", 18]] },
  { name: "E02", code: "const record = { ...(ready ? {} : { score: 8 }) };", reports: [["...(ready ? {} : { score: 8 })", 18]] },
  { name: "E03", code: "const record = { ...(ready ? {} : {}) };", reports: [["...(ready ? {} : {})", 18]] },
  { name: "E04", code: "const record = { ...((ready ? ({}) : source)) };", reports: [["...((ready ? ({}) : source))", 18]] },
  {
    name: "E05",
    code: "const record = { ...(ready ? { /* deliberately empty */ } : null) };",
    reports: [["...(ready ? { /* deliberately empty */ } : null)", 18]],
  },
  { name: "E06", code: "const record = { ...(ready ? { ...{} } : source) };" },
  { name: "E07", code: "const record = { ...(ready ? { run() {} } : source) };" },
  { name: "E08", code: "const record = { ...(ready ? { score: undefined } : source) };" },
  { name: "E09", code: "const record = { ...(ready && {}) };" },
  { name: "E10", code: "const record = { ...(ready ? ({} as object) : source) };" },
  { name: "E11", code: "const record = { ...((ready ? {} : source) as object) };" },
  { name: "E12", code: "const record = { ...(ready ? ({} satisfies object) : source) };" },
  { name: "E13", code: "const empty = {}; const record = { ...(ready ? empty : source) };" },
  { name: "E14", code: "const record = { ...(ready ? (later ? {} : source) : replacement) };" },
  { name: "E15", code: "const list = [...(ready ? {} : source)]; receive(...(ready ? {} : source));" },
  { name: "E16", code: "const view = <output {...(ready ? {} : source)} />;", tsx: true },
  {
    name: "E17",
    code: "const record = { ...(ready ? {} : first), ...(later ? second : {}) };",
    reports: [
      ["...(ready ? {} : first)", 18],
      ["...(later ? second : {})", 43],
    ],
  },
  { name: "E18", code: "const record = ready ? {} : { score: 8 };" },
  { name: "E19", code: "const record = { ...(ready ? {}! : source) };" },
  { name: "E20", code: "const record = { ...((ready ? {} : source)!) };" },
  { name: "E21", code: "const record = { ...(ready || {}) };" },
  {
    name: "E22",
    code: "const record = { ...(ready ? {} : { ...(later ? {} : source) }) };",
    reports: [
      ["...(ready ? {} : { ...(later ? {} : source) })", 18],
      ["...(later ? {} : source)", 37],
    ],
  },
]);
