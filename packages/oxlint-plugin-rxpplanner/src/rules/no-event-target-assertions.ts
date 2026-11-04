import { defineRule, type ESTree } from "@oxlint/plugins";
import { unwrapParentheses } from "../ast.ts";

const targetNames = new Set(["target", "relatedTarget", "currentTarget"]);

function isEventTarget(node: ESTree.Node): boolean {
  const inner = unwrapParentheses(node);
  const member = inner.type === "ChainExpression" ? inner.expression : inner;
  return (
    member.type === "MemberExpression" && !member.computed && member.property.type === "Identifier" && targetNames.has(member.property.name)
  );
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      eventTarget:
        "This assertion narrows an event target without a check. Narrow it with `instanceof`, or type the handler with its element, instead.",
    },
  },
  create(context) {
    function check(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void {
      if (isEventTarget(node.expression)) context.report({ node, messageId: "eventTarget" });
    }
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
});
