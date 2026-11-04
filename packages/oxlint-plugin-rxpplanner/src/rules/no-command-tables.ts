import { defineRule, type ESTree } from "@oxlint/plugins";
import { COMMANDS } from "../../../../src/guide/catalog.ts";
import { unwrapExpression } from "../ast.ts";

function isCommand(node: ESTree.Node | null | undefined): boolean {
  const literal = node && unwrapExpression(node);
  return literal?.type === "Literal" && typeof literal.value === "string" && COMMANDS.has(literal.value);
}

function isCommandEntry(node: ESTree.Node | null | undefined): boolean {
  const entry = node && unwrapExpression(node);
  return entry?.type === "ArrayExpression" && isCommand(entry.elements[0]);
}

const isCommandKey = (node: ESTree.Node): boolean =>
  node.type === "Property" &&
  !node.computed &&
  !node.shorthand &&
  (node.key.type === "Identifier" ? COMMANDS.has(node.key.name) : isCommand(node.key));

function table<T>(members: readonly T[], test: (member: T) => boolean): boolean {
  return members.length >= 2 && members.every(test);
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      commandTable:
        "This table keys commands apart from the command registry. Read or add a field of the syntax catalog (`COMMANDS` in src/guide/catalog.ts) or a facet of `COMMAND_RULES` in src/rules/commands.ts.",
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        const [arg] = node.arguments;
        const items = arg && unwrapExpression(arg);
        if (node.callee.type !== "Identifier" || items?.type !== "ArrayExpression") return;
        const test = node.callee.name === "Set" ? isCommand : node.callee.name === "Map" ? isCommandEntry : undefined;
        if (test && table(items.elements, test)) context.report({ node, messageId: "commandTable" });
      },
      ObjectExpression(node) {
        if (table(node.properties, isCommandKey)) context.report({ node, messageId: "commandTable" });
      },
    };
  },
});
