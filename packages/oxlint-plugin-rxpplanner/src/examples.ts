import type { Rule } from "@oxlint/plugins";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

interface Example {
  name: string;
  code: string;
  reports?: Array<[text: string, column: number]>;
  tsx?: boolean;
}

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

export function checkExamples(ruleId: string, rule: Rule, examples: Example[]): void {
  const [messageId = ""] = Object.keys(rule.meta?.messages ?? {});
  const valid: RuleTester.ValidTestCase[] = [];
  const invalid: RuleTester.InvalidTestCase[] = [];
  for (const { name, code, reports = [], tsx = false } of examples) {
    const languageOptions = { parserOptions: { lang: tsx ? ("tsx" as const) : ("ts" as const) } };
    if (reports.length === 0) {
      valid.push({ name, code, languageOptions });
      continue;
    }
    // RuleTester orders reports by start. Reports that share a start keep their report order, and an outer node is visited first.
    const ordered = reports.toSorted(([textA, columnA], [textB, columnB]) => columnA - columnB || textB.length - textA.length);
    const errors = ordered.map(([text, column]) => {
      const lines = text.split("\n");
      const last = lines.at(-1) ?? "";
      return {
        messageId,
        line: 1,
        column: column - 1,
        endLine: lines.length,
        endColumn: lines.length === 1 ? column - 1 + text.length : last.length,
      };
    });
    invalid.push({ name, code, languageOptions, errors });
  }
  tester.run(ruleId, rule, { valid, invalid });
}
