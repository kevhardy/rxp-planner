import { checkExamples } from "../examples.ts";
import rule from "./no-chained-type-assertions.ts";

checkExamples("no-chained-type-assertions", rule, [
  { name: "C01", code: "const chosen = packet as Packet;" },
  { name: "C02", code: "const chosen = <Packet>packet;" },
  { name: "C03", code: "packet as unknown as Packet;", reports: [["packet as unknown as Packet", 1]] },
  { name: "C04", code: "((packet as object)) as Packet;", reports: [["((packet as object)) as Packet", 1]] },
  { name: "C05", code: "<Packet>(<unknown>packet);", reports: [["<Packet>(<unknown>packet)", 1]] },
  { name: "C06", code: "(<object>packet) as Packet;", reports: [["(<object>packet) as Packet", 1]] },
  { name: "C07", code: "packet as unknown as object as Packet;", reports: [["packet as unknown as object as Packet", 1]] },
  { name: "C08", code: "({ score: 8 } as const) as const;" },
  { name: "C09", code: "({ score: 8 } as const) as Packet;", reports: [["({ score: 8 } as const) as Packet", 1]] },
  { name: "C10", code: "(packet as Packet) as const;", reports: [["(packet as Packet) as const", 1]] },
  { name: "C11", code: "(packet as unknown)! as Packet;" },
  { name: "C12", code: "(packet as unknown satisfies object) as Packet;" },
  { name: "C13", code: "(packet satisfies object) as Packet;" },
  {
    name: "C14",
    code: "(packet as unknown as object)! as Packet as FinalPacket;",
    reports: [
      ["packet as unknown as object", 2],
      ["(packet as unknown as object)! as Packet as FinalPacket", 1],
    ],
  },
  { name: "C15", code: "((packet as unknown), fallback) as Packet;" },
  { name: "C16", code: "type Pair = unknown & object;" },
  {
    name: "C17",
    code: "const chosen = <output>{packet as unknown as Packet}</output>;",
    reports: [["packet as unknown as Packet", 25]],
    tsx: true,
  },
  { name: "C18", code: "const chosen = ((packet as unknown as Packet));", reports: [["packet as unknown as Packet", 18]] },
]);
