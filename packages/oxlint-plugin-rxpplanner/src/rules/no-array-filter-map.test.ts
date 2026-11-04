import { checkExamples } from "../examples.ts";
import rule from "./no-array-filter-map.ts";

checkExamples("no-array-filter-map", rule, [
  { name: "A01", code: "[8, 13].filter(keepLarge).map(doubleIt);", reports: [["[8, 13].filter(keepLarge).map(doubleIt)", 1]] },
  { name: "A02", code: "[8, 13].map(doubleIt).filter(keepLarge);", reports: [["[8, 13].map(doubleIt).filter(keepLarge)", 1]] },
  {
    name: "A03",
    code: "const scores = [8]; const mirror = scores; mirror.filter(keepLarge).map(doubleIt);",
    reports: [["mirror.filter(keepLarge).map(doubleIt)", 44]],
  },
  {
    name: "A04",
    code: "function rank(scores: readonly [number, number]) { scores.filter(keepLarge).map(doubleIt); }",
    reports: [["scores.filter(keepLarge).map(doubleIt)", 52]],
  },
  {
    name: "A05",
    code: "function rank(scores: ReadonlyArray<number>) { scores.map(doubleIt).filter(keepLarge); }",
    reports: [["scores.map(doubleIt).filter(keepLarge)", 48]],
  },
  {
    name: "A06",
    code: "let scores: number[] = obtainScores(); scores.filter(keepLarge).map(doubleIt);",
    reports: [["scores.filter(keepLarge).map(doubleIt)", 40]],
  },
  { name: "A07", code: "let scores = [8]; scores.filter(keepLarge).map(doubleIt);" },
  { name: "A08", code: "let scores: number[] = [8]; scores.filter(keepLarge).map(doubleIt); scores = replacement;" },
  { name: "A09", code: "const scores = [8]; function rank(scores) { scores.filter(keepLarge).map(doubleIt); }" },
  { name: "A10", code: "type Scores = number[]; function rank(scores: Scores) { scores.filter(keepLarge).map(doubleIt); }" },
  { name: "A11", code: "const scores: unknown = [8]; scores.filter(keepLarge).map(doubleIt);" },
  { name: "A12", code: "(externalScores as number[]).filter(keepLarge).map(doubleIt);" },
  {
    name: "A13",
    code: "([8] satisfies number[])['filter'](keepLarge)['map'](doubleIt);",
    reports: [["([8] satisfies number[])['filter'](keepLarge)['map'](doubleIt)", 1]],
  },
  {
    name: "A14",
    code: "const scores = [8]; scores?.filter?.(keepLarge)?.map?.(doubleIt);",
    reports: [["scores?.filter?.(keepLarge)?.map?.(doubleIt)", 21]],
  },
  { name: "A15", code: "([8].filter(keepLarge)!).map(doubleIt);", reports: [["([8].filter(keepLarge)!).map(doubleIt)", 1]] },
  {
    name: "A16",
    code: "[8].filter(keepLarge).map(doubleIt).filter(keepEven);",
    reports: [
      ["[8].filter(keepLarge).map(doubleIt)", 1],
      ["[8].filter(keepLarge).map(doubleIt).filter(keepEven)", 1],
    ],
  },
  { name: "A17", code: "[8].filter(keepLarge).slice().map(doubleIt);" },
  {
    name: "A18",
    code: "[8].flatMap(expandScore).filter(keepLarge).map(doubleIt);",
    reports: [["[8].flatMap(expandScore).filter(keepLarge).map(doubleIt)", 1]],
  },
  { name: "A19", code: "[8].values().filter(keepLarge).map(doubleIt);" },
  { name: "A20", code: "Array.from(externalScores).filter(keepLarge).map(doubleIt);" },
  { name: "A21", code: "[8][filterName](keepLarge).map(doubleIt);" },
  { name: "A22", code: "[8][`filter`](keepLarge).map(doubleIt);" },
  { name: "A23", code: "[8].filter().map();", reports: [["[8].filter().map()", 1]] },
  { name: "A24", code: "const partial = [8].filter(keepLarge); partial.map(doubleIt);" },
  {
    name: "A25",
    code: "const scores = [8]; scores.push(21); scores.filter(keepLarge).map(doubleIt);",
    reports: [["scores.filter(keepLarge).map(doubleIt)", 38]],
  },
  {
    name: "A26",
    code: "type Array<T> = Strange<T>; function rank(scores: Array<number>) { scores.filter(keepLarge).map(doubleIt); }",
    reports: [["scores.filter(keepLarge).map(doubleIt)", 68]],
  },
  { name: "A27", code: "function rank(scores: number[] | readonly number[]) { scores.filter(keepLarge).map(doubleIt); }" },
  { name: "A28", code: "const scores = other; const other = scores; scores.filter(keepLarge).map(doubleIt);" },
  {
    name: "A29",
    code: "const view = <output>{[8].filter(keepLarge).map(doubleIt)}</output>;",
    reports: [["[8].filter(keepLarge).map(doubleIt)", 23]],
    tsx: true,
  },
  { name: "A30", code: "[8].map(doubleIt).map(toLabel); [8].filter(keepLarge).filter(keepEven);" },
  {
    name: "A31",
    code: "[8].filter<number>(keepLarge).map<string>(toLabel);",
    reports: [["[8].filter<number>(keepLarge).map<string>(toLabel)", 1]],
  },
  { name: "A32", code: "([8].filter<number>)(keepLarge).map(toLabel);" },
  {
    name: "A33",
    code: "(<number[]>[8]).filter(keepLarge).map(doubleIt);",
    reports: [["(<number[]>[8]).filter(keepLarge).map(doubleIt)", 1]],
  },
  { name: "A34", code: "const [scores] = [[8]]; scores.filter(keepLarge).map(doubleIt);" },
  { name: "A35", code: "function rank(scores: Domain.Array<number>) { scores.filter(keepLarge).map(doubleIt); }" },
]);
