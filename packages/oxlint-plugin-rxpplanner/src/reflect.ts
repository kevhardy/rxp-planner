import { defineRule, type ESTree } from "@oxlint/plugins";
import { isGlobal } from "./scope.ts";

export function reflectCallRule(method: string, message: string) {
  return defineRule({
    meta: { type: "suggestion", messages: { reflective: message } },
    create(context) {
      return {
        CallExpression(node: ESTree.CallExpression) {
          const callee = node.callee;
          if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier" || callee.object.name !== "Reflect") return;
          const property = callee.property;
          const named = callee.computed
            ? property.type === "Literal" && property.value === method
            : property.type === "Identifier" && property.name === method;
          if (named && isGlobal(context.sourceCode, callee.object)) context.report({ node, messageId: "reflective" });
        },
      };
    },
  });
}
