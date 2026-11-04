import { defineRule, type ESTree } from "@oxlint/plugins";
import { isTypeAssertion, unwrapParentheses } from "../ast.ts";

function isConstAssertion(assertion: ESTree.TSAsExpression | ESTree.TSTypeAssertion): boolean {
  const type = assertion.typeAnnotation;
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === "const";
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      chained: "This value passes through more than one type assertion. Keep the type evidence, or check the value, instead.",
    },
  },
  create(context) {
    function check(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void {
      let outer: ESTree.Node = node;
      while (outer.parent.type === "ParenthesizedExpression") outer = outer.parent;
      if (isTypeAssertion(outer.parent) && unwrapParentheses(outer.parent.expression) === node) return;
      const chain = [node];
      for (let inner = unwrapParentheses(node.expression); isTypeAssertion(inner); inner = unwrapParentheses(inner.expression))
        chain.push(inner);
      if (chain.length > 1 && !chain.every(isConstAssertion)) context.report({ node, messageId: "chained" });
    }
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
});
