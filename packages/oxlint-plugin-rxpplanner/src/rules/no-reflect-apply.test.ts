import { checkExamples } from "../examples.ts";
import rule from "./no-reflect-apply.ts";

checkExamples("no-reflect-apply", rule, [
  { name: "P01", code: "Reflect.apply(renderRow, panel, [8]);", reports: [["Reflect.apply(renderRow, panel, [8])", 1]] },
  { name: "P02", code: "Reflect['apply'](renderRow, panel, []);", reports: [["Reflect['apply'](renderRow, panel, [])", 1]] },
  { name: "P03", code: "Reflect?.apply?.();", reports: [["Reflect?.apply?.()", 1]] },
  {
    name: "P04",
    code: "(Reflect).apply(); (Reflect.apply)();",
    reports: [
      ["(Reflect).apply()", 1],
      ["(Reflect.apply)()", 20],
    ],
  },
  { name: "P05", code: "Reflect[`apply`]();" },
  { name: "P06", code: "Reflect['ap' + 'ply']();" },
  { name: "P07", code: "Reflect[method]();" },
  { name: "P08", code: "Reflect.get(panel, 'score'); renderRow.apply(panel, []);" },
  { name: "P09", code: "const reflector = Reflect; reflector.apply();" },
  { name: "P10", code: "const { apply: invoke } = Reflect; invoke();" },
  { name: "P11", code: "function execute(Reflect) { Reflect.apply(); }" },
  { name: "P12", code: "{ Reflect.apply(); const Reflect = customReflector; }" },
  { name: "P13", code: "declare const Reflect: Reflector; Reflect.apply();" },
  { name: "P14", code: "globalThis.Reflect.apply();" },
  { name: "P15", code: "(Reflect as Reflector).apply();" },
  { name: "P16", code: "(Reflect.apply as Invoker)();" },
  { name: "P17", code: "Reflect!.apply(); Reflect.apply!();" },
  { name: "P18", code: "const invoke = Reflect.apply; new Reflect.apply();" },
  { name: "P19", code: "Reflect = customReflector; Reflect.apply();", reports: [["Reflect.apply()", 28]] },
  {
    name: "P20",
    code: "Reflect.apply(Reflect.apply(renderRow, panel, []), panel, []);",
    reports: [
      ["Reflect.apply(Reflect.apply(renderRow, panel, []), panel, [])", 1],
      ["Reflect.apply(renderRow, panel, [])", 15],
    ],
  },
  {
    name: "P21",
    code: "const view = <output>{Reflect.apply(renderRow, panel, [])}</output>;",
    reports: [["Reflect.apply(renderRow, panel, [])", 23]],
    tsx: true,
  },
  { name: "P22", code: "(Reflect?.apply)();" },
  { name: "P23", code: "Reflect.apply<Score>();", reports: [["Reflect.apply<Score>()", 1]] },
  { name: "P24", code: "(Reflect.apply<Score>)();" },
  { name: "P25", code: "Reflect.apply`score`;" },
  { name: "P26", code: "import { Reflect } from 'owner'; Reflect.apply();" },
  { name: "P27", code: "type Reflect = { apply(): void }; Reflect.apply();" },
  { name: "P28", code: 'import type { Reflect } from "owner"; Reflect.apply();' },
]);
