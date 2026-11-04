import { checkExamples } from "../examples.ts";
import rule from "./require-disable-reason.ts";

checkExamples("require-disable-reason", rule, [
  { name: "D01", code: "// oxlint-disable-next-line eslint/no-debugger -- the test pauses here\ndebugger;" },
  { name: "D02", code: "debugger; // oxlint-disable-line eslint/no-debugger -- the test pauses here" },
  { name: "D03", code: "/* oxlint-disable eslint/no-debugger -- the file pauses on purpose */" },
  { name: "D04", code: "// eslint-disable-next-line no-debugger -- the test pauses here\ndebugger;" },
  {
    name: "D05",
    code: "const view = <div>{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a reason */}</div>;",
    tsx: true,
  },
  { name: "D06", code: "// oxlint-enable eslint/no-debugger" },
  { name: "D07", code: "// oxlint-disable-next-line-example eslint/no-debugger" },
  { name: "D08", code: "// oxlint-disabled eslint/no-debugger" },
  { name: "D09", code: "// See oxlint-disable-next-line in the oxlint docs." },
  { name: "D10", code: "/** Write oxlint-disable-next-line with a reason. */" },
  { name: "D11", code: "/* oxlint-disable-next-line eslint/no-debugger -- the test pauses here\n   and the comment goes on */ debugger;" },
  { name: "D24", code: "/*\n  oxlint-disable eslint/no-debugger -- the file pauses on purpose\n*/" },
  {
    name: "D12",
    code: "// oxlint-disable-next-line eslint/no-debugger\ndebugger;",
    reports: [["// oxlint-disable-next-line eslint/no-debugger", 1]],
  },
  {
    name: "D13",
    code: "debugger; // oxlint-disable-line eslint/no-debugger",
    reports: [["// oxlint-disable-line eslint/no-debugger", 11]],
  },
  { name: "D14", code: "/* oxlint-disable eslint/no-debugger */", reports: [["/* oxlint-disable eslint/no-debugger */", 1]] },
  {
    name: "D15",
    code: "// eslint-disable-next-line no-debugger\ndebugger;",
    reports: [["// eslint-disable-next-line no-debugger", 1]],
  },
  {
    name: "D16",
    code: "const view = <div>{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}</div>;",
    reports: [["/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */", 20]],
    tsx: true,
  },
  {
    name: "D17",
    code: "/* oxlint-disable-next-line eslint/no-debugger\n   -- the reason is on the next line */ debugger;",
    reports: [["/* oxlint-disable-next-line eslint/no-debugger\n   -- the reason is on the next line */", 1]],
  },
  {
    name: "D18",
    code: "// oxlint-disable-next-line eslint/no-debugger -- \ndebugger;",
    reports: [["// oxlint-disable-next-line eslint/no-debugger -- ", 1]],
  },
  {
    name: "D19",
    code: "// oxlint-disable-next-line eslint/no-debugger --no space\ndebugger;",
    reports: [["// oxlint-disable-next-line eslint/no-debugger --no space", 1]],
  },
  {
    name: "D20",
    code: "// oxlint-disable-next-line eslint/no-debugger - one dash\ndebugger;",
    reports: [["// oxlint-disable-next-line eslint/no-debugger - one dash", 1]],
  },
  {
    name: "D21",
    code: "// oxlint-disable-next-line eslint/no-debugger because no dashes\ndebugger;",
    reports: [["// oxlint-disable-next-line eslint/no-debugger because no dashes", 1]],
  },
  {
    name: "D22",
    code: "//oxlint-disable-next-line eslint/no-debugger\ndebugger;",
    reports: [["//oxlint-disable-next-line eslint/no-debugger", 1]],
  },
  { name: "D23", code: "/* oxlint-disable */", reports: [["/* oxlint-disable */", 1]] },
  {
    name: "D25",
    code: "/*\n  oxlint-disable eslint/no-debugger\n*/",
    reports: [["/*\n  oxlint-disable eslint/no-debugger\n*/", 1]],
  },
]);
