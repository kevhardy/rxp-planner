import type { Context, ESTree, Variable } from "@oxlint/plugins";
import { staticMethodCall, unwrapExpression } from "./ast.ts";
import { constDeclarator, isReassigned, resolveReference } from "./scope.ts";

const arrayReturningMethods = new Set(["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"]);

function isArrayAnnotation(type: ESTree.TSType): boolean {
  switch (type.type) {
    case "TSArrayType":
    case "TSTupleType":
      return true;
    case "TSParenthesizedType":
      return isArrayAnnotation(type.typeAnnotation);
    case "TSTypeOperator":
      return type.operator === "readonly" && isArrayAnnotation(type.typeAnnotation);
    case "TSTypeReference":
      return type.typeName.type === "Identifier" && (type.typeName.name === "Array" || type.typeName.name === "ReadonlyArray");
    default:
      return false;
  }
}

export function isKnownArray(sourceCode: Context["sourceCode"], expression: ESTree.Node, seen = new Set<Variable>()): boolean {
  const node = unwrapExpression(expression);
  if (node.type === "ArrayExpression") return true;
  if (node.type === "CallExpression") {
    const method = staticMethodCall(node);
    return method !== null && arrayReturningMethods.has(method.name) && isKnownArray(sourceCode, method.receiver, seen);
  }
  if (node.type !== "Identifier") return false;
  const variable = resolveReference(sourceCode, node);
  if (!variable || seen.has(variable) || isReassigned(variable)) return false;
  seen.add(variable);
  const annotated = variable.identifiers.find((identifier) => identifier.typeAnnotation);
  if (annotated?.typeAnnotation) return isArrayAnnotation(annotated.typeAnnotation.typeAnnotation);
  const constant = constDeclarator(variable);
  return constant !== null && constant.declarator.id.type === "Identifier" && isKnownArray(sourceCode, constant.init, seen);
}
