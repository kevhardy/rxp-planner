import type { ESTree } from "@oxlint/plugins";

export function unwrapParentheses(node: ESTree.Node): ESTree.Node {
  return node.type === "ParenthesizedExpression" ? unwrapParentheses(node.expression) : node;
}

type ExpressionWrapper =
  | ESTree.ParenthesizedExpression
  | ESTree.ChainExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion
  | ESTree.TSNonNullExpression
  | ESTree.TSSatisfiesExpression;

const wrapperTypes = new Set([
  "ParenthesizedExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

export function isExpressionWrapper(node: ESTree.Node): node is ExpressionWrapper {
  return wrapperTypes.has(node.type);
}

export function unwrapExpression(node: ESTree.Node): ESTree.Node {
  return isExpressionWrapper(node) ? unwrapExpression(node.expression) : node;
}

export function unwrapTypeParentheses(node: ESTree.TSType): ESTree.TSType {
  return node.type === "TSParenthesizedType" ? unwrapTypeParentheses(node.typeAnnotation) : node;
}

export function isTypeAssertion(node: ESTree.Node): node is ESTree.TSAsExpression | ESTree.TSTypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

export function staticMethodCall(call: ESTree.CallExpression): { name: string; receiver: ESTree.Expression } | null {
  const callee = unwrapExpression(call.callee);
  if (callee.type !== "MemberExpression") return null;
  if (!callee.computed && callee.property.type === "Identifier") return { name: callee.property.name, receiver: callee.object };
  if (callee.computed && callee.property.type === "Literal" && typeof callee.property.value === "string") {
    return { name: callee.property.value, receiver: callee.object };
  }
  return null;
}
