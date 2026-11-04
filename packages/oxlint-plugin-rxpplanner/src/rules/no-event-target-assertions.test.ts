import { checkExamples } from "../examples.ts";
import rule from "./no-event-target-assertions.ts";

checkExamples("no-event-target-assertions", rule, [
  { name: "E01", code: "const node = event.target as Node;", reports: [["event.target as Node", 14]] },
  { name: "E02", code: "const next = event.relatedTarget as Element | null;", reports: [["event.relatedTarget as Element | null", 14]] },
  {
    name: "E03",
    code: "const field = event.currentTarget as HTMLInputElement;",
    reports: [["event.currentTarget as HTMLInputElement", 15]],
  },
  { name: "E04", code: "(((event.target)) as Element).closest('a');", reports: [["((event.target)) as Element", 2]] },
  { name: "E05", code: "<Element>event.target;", reports: [["<Element>event.target", 1]] },
  { name: "E06", code: "event?.target as Node;", reports: [["event?.target as Node", 1]] },
  { name: "E07", code: "if (event.target instanceof Node && !panel.contains(event.target)) close();" },
  { name: "E08", code: "const sides = [event.target, event.relatedTarget] as const;" },
  { name: "E09", code: "const detail = event.detail as Detail;" },
]);
