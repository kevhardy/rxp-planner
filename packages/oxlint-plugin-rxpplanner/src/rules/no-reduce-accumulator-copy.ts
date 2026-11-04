import { defineRule, type Context, type ESTree, type Variable } from "@oxlint/plugins";
import { isKnownArray } from "../arrays.ts";
import { isExpressionWrapper, staticMethodCall, unwrapExpression } from "../ast.ts";
import { constDeclarator, isGlobal, resolveReference } from "../scope.ts";

type SourceCode = Context["sourceCode"];
type Callback = ESTree.ArrowFunctionExpression | ESTree.Function;

const arrayCopyMethods = new Set(["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"]);

function reducerCall(callback: Callback): ESTree.CallExpression | null {
  let argument: ESTree.Node = callback;
  while (isExpressionWrapper(argument.parent) && argument.parent.expression === argument) argument = argument.parent;
  const call = argument.parent;
  if (call.type !== "CallExpression" || call.arguments[0] !== argument || call.arguments.length > 2) return null;
  const method = staticMethodCall(call);
  return method?.name === "reduce" || method?.name === "reduceRight" ? call : null;
}

function enclosingCallback(node: ESTree.Node): Callback | null {
  for (let current: ESTree.Node | null = node.parent; current; current = current.parent) {
    if (current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") return current;
    if (current.type === "FunctionDeclaration") return null;
  }
  return null;
}

function accumulatorOf(sourceCode: SourceCode, callback: Callback): Variable | null {
  const first = callback.params[0];
  const identifier = first?.type === "AssignmentPattern" ? first.left : first;
  if (identifier?.type !== "Identifier") return null;
  return (
    sourceCode
      .getDeclaredVariables(callback)
      .find((variable) => variable.identifiers.some((binding) => binding.start === identifier.start)) ?? null
  );
}

function isAccumulator(sourceCode: SourceCode, expression: ESTree.Node, accumulator: Variable, seen = new Set<Variable>()): boolean {
  const node = unwrapExpression(expression);
  if (node.type !== "Identifier") return false;
  const variable = resolveReference(sourceCode, node);
  if (!variable) return false;
  if (variable === accumulator) return true;
  if (seen.has(variable)) return false;
  seen.add(variable);
  const constant = constDeclarator(variable);
  return constant !== null && constant.declarator.id.type === "Identifier" && isAccumulator(sourceCode, constant.init, accumulator, seen);
}

function isGlobalNamed(sourceCode: SourceCode, expression: ESTree.Expression, name: string): boolean {
  const node = unwrapExpression(expression);
  return node.type === "Identifier" && node.name === name && isGlobal(sourceCode, node);
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      copy: "This reducer copies its accumulator on every step. Mutate the accumulator, or build the result with a loop.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    function copiesAccumulator(call: ESTree.CallExpression, reducer: ESTree.CallExpression, accumulator: Variable): boolean {
      const method = staticMethodCall(call);
      if (!method) return false;
      const [first, ...rest] = call.arguments;
      if (method.name === "assign" && isGlobalNamed(sourceCode, method.receiver, "Object")) {
        return (
          first !== undefined &&
          unwrapExpression(first).type === "ObjectExpression" &&
          rest.some((argument) => isAccumulator(sourceCode, argument, accumulator))
        );
      }
      if (method.name === "from" && isGlobalNamed(sourceCode, method.receiver, "Array")) {
        return first !== undefined && isAccumulator(sourceCode, first, accumulator);
      }
      const initial = reducer.arguments[1];
      return (
        arrayCopyMethods.has(method.name) &&
        isAccumulator(sourceCode, method.receiver, accumulator) &&
        initial !== undefined &&
        isKnownArray(sourceCode, initial)
      );
    }
    return {
      CallExpression(node) {
        const callback = enclosingCallback(node);
        const reducer = callback && reducerCall(callback);
        const accumulator = callback && reducer && accumulatorOf(sourceCode, callback);
        if (reducer && accumulator && copiesAccumulator(node, reducer, accumulator)) context.report({ node, messageId: "copy" });
      },
    };
  },
});
