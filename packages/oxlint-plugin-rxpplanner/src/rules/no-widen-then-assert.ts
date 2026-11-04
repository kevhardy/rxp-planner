import { defineRule, type ESTree, type Variable } from "@oxlint/plugins";
import { isTypeAssertion, unwrapParentheses, unwrapTypeParentheses } from "../ast.ts";
import { constDeclarator, isReassigned, resolveReference } from "../scope.ts";

type Category = "top" | "object" | "record";
interface Evidence {
  type: ESTree.TSType | null;
}

const boundaryTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);
const knownValueTypes = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "FunctionExpression",
  "NewExpression",
  "ObjectExpression",
  "Literal",
  "TemplateLiteral",
]);

function functionBoundary(node: ESTree.Node): ESTree.Node {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (boundaryTypes.has(current.type)) return current;
  }
  return current;
}

function referenceName(type: ESTree.TSType, name: string): ESTree.TSTypeReference | null {
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier" && type.typeName.name === name ? type : null;
}

function isTopType(type: ESTree.TSType): boolean {
  const inner = unwrapTypeParentheses(type);
  return inner.type === "TSUnknownKeyword" || inner.type === "TSAnyKeyword";
}

function isBroadKey(type: ESTree.TSType): boolean {
  const inner = unwrapTypeParentheses(type);
  switch (inner.type) {
    case "TSStringKeyword":
    case "TSNumberKeyword":
    case "TSSymbolKeyword":
      return true;
    case "TSUnionType":
      return inner.types.every(isBroadKey);
    default:
      return referenceName(inner, "PropertyKey") !== null;
  }
}

function isBroadRecord(type: ESTree.TSType): boolean {
  const inner = unwrapTypeParentheses(type);
  const args = inner.type === "TSTypeReference" ? (inner.typeArguments?.params ?? []) : [];
  if (referenceName(inner, "Record")) return args.length === 2 && isBroadKey(args[0]!) && isTopType(args[1]!);
  if (referenceName(inner, "Readonly")) return args[0] !== undefined && isBroadRecord(args[0]);
  if (inner.type !== "TSTypeLiteral" || inner.members.length !== 1) return false;
  const [member] = inner.members;
  if (member?.type !== "TSIndexSignature" || member.parameters.length !== 1) return false;
  return isBroadKey(member.parameters[0]!.typeAnnotation.typeAnnotation) && isTopType(member.typeAnnotation.typeAnnotation);
}

function broadCategory(type: ESTree.TSType): Category | null {
  const inner = unwrapTypeParentheses(type);
  if (isTopType(inner)) return "top";
  if (inner.type === "TSObjectKeyword") return "object";
  return isBroadRecord(inner) ? "record" : null;
}

function isDefinitelyObject(type: ESTree.TSType): boolean {
  const inner = unwrapTypeParentheses(type);
  switch (inner.type) {
    case "TSArrayType":
    case "TSConstructorType":
    case "TSFunctionType":
    case "TSMappedType":
    case "TSObjectKeyword":
    case "TSTupleType":
      return true;
    case "TSTypeLiteral":
      return inner.members.length > 0;
    case "TSIntersectionType":
      return inner.types.every(isDefinitelyObject);
    case "TSTypeOperator":
      return inner.operator === "readonly" && isDefinitelyObject(inner.typeAnnotation);
    default:
      return false;
  }
}

function isNarrowerRecord(type: ESTree.TSType): boolean {
  const inner = unwrapTypeParentheses(type);
  if (inner.type === "TSTypeLiteral") return inner.members.some((member) => member.type !== "TSIndexSignature");
  const args = inner.type === "TSTypeReference" ? (inner.typeArguments?.params ?? []) : [];
  if (referenceName(inner, "Record")) return args.length === 2 && !isTopType(args[1]!);
  return referenceName(inner, "Readonly") !== null && args[0] !== undefined && isNarrowerRecord(args[0]);
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      widenThenAssert:
        "This binding was widened from a known type, and this assertion narrows it again. Keep the known type on the binding instead.",
    },
  },
  create(context) {
    const { sourceCode } = context;

    function sameTypeText(a: ESTree.TSType, b: ESTree.TSType): boolean {
      const text = (type: ESTree.TSType) => sourceCode.getText(unwrapTypeParentheses(type)).replace(/\s+/g, "");
      return text(a) === text(b);
    }

    function evidenceOf(expression: ESTree.Node, boundary: ESTree.Node, seen = new Set<Variable>()): Evidence | null {
      const node = unwrapParentheses(expression);
      if (isTypeAssertion(node)) return broadCategory(node.typeAnnotation) ? null : { type: node.typeAnnotation };
      if (knownValueTypes.has(node.type)) return { type: null };
      if (node.type !== "Identifier") return null;
      const variable = resolveReference(sourceCode, node);
      if (!variable || seen.has(variable)) return null;
      seen.add(variable);
      const annotated = variable.identifiers.find((identifier) => identifier.typeAnnotation);
      if (annotated?.typeAnnotation) {
        const type = annotated.typeAnnotation.typeAnnotation;
        return functionBoundary(annotated) === boundary && !broadCategory(type) ? { type } : null;
      }
      const constant = constDeclarator(variable);
      if (!constant || functionBoundary(constant.declarator) !== boundary) return null;
      return evidenceOf(constant.init, boundary, seen);
    }

    function check(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void {
      const target = node.typeAnnotation;
      const identifier = unwrapParentheses(node.expression);
      if (identifier.type !== "Identifier" || broadCategory(target)) return;
      const variable = resolveReference(sourceCode, identifier);
      if (!variable || isReassigned(variable)) return;
      const constant = constDeclarator(variable);
      if (!constant || constant.declarator.id.type !== "Identifier") return;
      const { declarator, init } = constant;
      const boundary = functionBoundary(declarator);
      if (node.start <= declarator.end || functionBoundary(node) !== boundary) return;

      const declared = declarator.id.typeAnnotation?.typeAnnotation;
      const initializer = unwrapParentheses(init);
      const widening = isTypeAssertion(initializer) && broadCategory(initializer.typeAnnotation) ? initializer : null;
      const category = (declared && broadCategory(declared)) ?? (widening && broadCategory(widening.typeAnnotation));
      if (!category) return;
      const evidence = evidenceOf(widening ? widening.expression : init, boundary);
      if (!evidence) return;

      const narrows =
        category === "top" ||
        (evidence.type !== null && sameTypeText(target, evidence.type)) ||
        (category === "object" && isDefinitelyObject(target)) ||
        (category === "record" && isNarrowerRecord(target));
      if (narrows) context.report({ node, messageId: "widenThenAssert" });
    }

    return { TSAsExpression: check, TSTypeAssertion: check };
  },
});
