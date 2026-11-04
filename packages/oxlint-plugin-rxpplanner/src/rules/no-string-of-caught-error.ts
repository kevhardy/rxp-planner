import { defineRule, type Context, type ESTree, type Variable } from "@oxlint/plugins";
import { isExpressionWrapper, staticMethodCall, unwrapExpression } from "../ast.ts";
import { isGlobal, resolveReference } from "../scope.ts";

type SourceCode = Context["sourceCode"];
type Handler = ESTree.ArrowFunctionExpression | ESTree.Function;
type Child = Exclude<ESTree.Node, ESTree.Program>;

function withWrappers(node: Child): Child {
  let current = node;
  while (isExpressionWrapper(current.parent) && current.parent.expression === current) current = current.parent;
  return current;
}

function outermostValue(node: Child): Child {
  const parent = node.parent;
  if (isExpressionWrapper(parent) && parent.expression === node) return outermostValue(parent);
  if (parent.type === "ConditionalExpression" && parent.test !== node) return outermostValue(parent);
  if (parent.type === "LogicalExpression") return outermostValue(parent);
  return node;
}

function isRejectionHandler(handler: Handler): boolean {
  const node = withWrappers(handler);
  const call = node.parent;
  if (call.type !== "CallExpression") return false;
  const method = staticMethodCall(call)?.name;
  return (method === "catch" && call.arguments[0] === node) || (method === "then" && call.arguments[1] === node);
}

function declared(sourceCode: SourceCode, node: ESTree.Node, param: ESTree.Node | null | undefined): Variable | undefined {
  const binding = param?.type === "AssignmentPattern" ? param.left : param;
  if (binding?.type !== "Identifier") return undefined;
  return sourceCode.getDeclaredVariables(node).find((variable) => variable.identifiers.some((id) => id.start === binding.start));
}

export default defineRule({
  meta: {
    type: "problem",
    messages: {
      classPrefix:
        "This text puts the error's class name in front, such as `TypeError: Failed to fetch`. Use `errorText(error)` from `src/data/errorText.ts`.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const isGlobalNamed = (node: ESTree.Node, name: string) => {
      const inner = unwrapExpression(node);
      return inner.type === "Identifier" && inner.name === name && isGlobal(sourceCode, inner);
    };
    const isNonErrorBranch = (call: ESTree.CallExpression, variable: Variable) => {
      const node = withWrappers(call);
      const parent = node.parent;
      if (parent.type !== "ConditionalExpression" || parent.alternate !== node) return false;
      const test = unwrapExpression(parent.test);
      if (test.type !== "BinaryExpression" || test.operator !== "instanceof") return false;
      const left = unwrapExpression(test.left);
      return left.type === "Identifier" && resolveReference(sourceCode, left) === variable && isGlobalNamed(test.right, "Error");
    };
    const check = (variable: Variable | undefined) => {
      if (!variable) return;
      for (const { identifier } of variable.references) {
        const node = outermostValue(identifier);
        const parent = node.parent;
        if (parent.type === "CallExpression" && isGlobalNamed(parent.callee, "String")) {
          if (!isNonErrorBranch(parent, variable)) context.report({ node: parent, messageId: "classPrefix" });
        } else if (parent.type === "TemplateLiteral" && parent.parent.type !== "TaggedTemplateExpression") {
          context.report({ node, messageId: "classPrefix" });
        } else if (parent.type === "BinaryExpression" && parent.operator === "+") {
          context.report({ node: parent, messageId: "classPrefix" });
        }
      }
    };
    return {
      CatchClause(node) {
        check(declared(sourceCode, node, node.param));
      },
      ArrowFunctionExpression(node) {
        if (isRejectionHandler(node)) check(declared(sourceCode, node, node.params[0]));
      },
      FunctionExpression(node) {
        if (isRejectionHandler(node)) check(declared(sourceCode, node, node.params[0]));
      },
    };
  },
});
