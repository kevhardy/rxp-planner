import { checkExamples } from "../examples.ts";
import rule from "./no-reflect-get.ts";

checkExamples("no-reflect-get", rule, [
  { name: "G01", code: "Reflect.get(panel, 'score');", reports: [["Reflect.get(panel, 'score')", 1]] },
  { name: "G02", code: "Reflect['get'](panel, 8);", reports: [["Reflect['get'](panel, 8)", 1]] },
  { name: "G03", code: "Reflect?.get?.();", reports: [["Reflect?.get?.()", 1]] },
  {
    name: "G04",
    code: "(Reflect).get(); (Reflect.get)();",
    reports: [
      ["(Reflect).get()", 1],
      ["(Reflect.get)()", 18],
    ],
  },
  { name: "G05", code: "Reflect[`get`]();" },
  { name: "G06", code: "Reflect['g' + 'et']();" },
  { name: "G07", code: "Reflect[key]();" },
  { name: "G08", code: "Reflect.apply(renderRow, panel, []); panel.get('score');" },
  { name: "G09", code: "const reflector = Reflect; reflector.get();" },
  { name: "G10", code: "const { get: read } = Reflect; read();" },
  { name: "G11", code: "function read(Reflect) { Reflect.get(); }" },
  { name: "G12", code: "try {} catch (Reflect) { Reflect.get(); }" },
  { name: "G13", code: "declare const Reflect: Reflector; Reflect.get();" },
  { name: "G14", code: "globalThis.Reflect.get();" },
  { name: "G15", code: "(Reflect satisfies Reflector).get();" },
  { name: "G16", code: "(Reflect.get as Reader)();" },
  { name: "G17", code: "Reflect!.get(); Reflect.get!();" },
  { name: "G18", code: "const read = Reflect.get; new Reflect.get();" },
  { name: "G19", code: "Reflect = customReflector; Reflect.get();", reports: [["Reflect.get()", 28]] },
  {
    name: "G20",
    code: "Reflect.get(Reflect.get(panel, 'nested'), 'score');",
    reports: [
      ["Reflect.get(Reflect.get(panel, 'nested'), 'score')", 1],
      ["Reflect.get(panel, 'nested')", 13],
    ],
  },
  {
    name: "G21",
    code: "const view = <output>{Reflect.get(panel, 'score')}</output>;",
    reports: [["Reflect.get(panel, 'score')", 23]],
    tsx: true,
  },
  { name: "G22", code: "(Reflect?.get)();" },
  { name: "G23", code: "Reflect.get<Score>();", reports: [["Reflect.get<Score>()", 1]] },
  { name: "G24", code: "(Reflect.get<Score>)();" },
  { name: "G25", code: "Reflect.get`score`;" },
  { name: "G26", code: "import { Reflect } from 'owner'; Reflect.get();" },
  { name: "G27", code: "type Reflect = { get(): void }; Reflect.get();" },
  { name: "G28", code: 'import type { Reflect } from "owner"; Reflect.get();' },
]);
