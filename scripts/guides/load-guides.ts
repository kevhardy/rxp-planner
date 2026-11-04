import { fileURLToPath } from "node:url";
import type { AddonGuide } from "../../src/io/addon.ts";
import { BUILTIN_PATH, decodeBuiltins } from "../../src/io/builtin.ts";
import type { GuideRecord } from "../../src/guide/index.ts";

export const BUILTIN_FILE = fileURLToPath(new URL(`../../public/${BUILTIN_PATH}`, import.meta.url));

/**
 * The guides in RXP's load order, as the planner registers them: built-ins
 * in bundle order, then the extra guides, which override built-ins of the
 * same group and name.
 */
export async function loadGuides(builtins: Uint8Array<ArrayBuffer>, extraGuides: readonly AddonGuide[] = []) {
  const { version, guides } = await decodeBuiltins(builtins);
  const records = [
    ...guides,
    ...extraGuides.map(({ text, registerArgs }, i): GuideRecord => ({
      id: `extra:${i}`,
      text,
      order: guides.length + i,
      ...(registerArgs && { registerArgs }),
    })),
  ];
  return { version, records };
}
