import { defineRule, type ESTree } from "@oxlint/plugins";
import { unwrapParentheses } from "../ast.ts";

function isEmptyObject(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      emptyBranch: "This spread adds properties only on one branch of a condition. Set the optional property in its own statement instead.",
    },
  },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const argument = unwrapParentheses(node.argument);
        if (argument.type === "ConditionalExpression" && (isEmptyObject(argument.consequent) || isEmptyObject(argument.alternate))) {
          context.report({ node, messageId: "emptyBranch" });
        }
      },
    };
  },
});
