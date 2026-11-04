import { defineRule, type ESTree } from "@oxlint/plugins";
import { typeAliasIndex } from "../typeAliases.ts";

type FunctionLike =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

const functionTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSFunctionType",
  "TSMethodSignature",
]);

function isFunctionLike(node: ESTree.Node): node is FunctionLike {
  return functionTypes.has(node.type);
}

function parameterType(parameter: ESTree.ParamPattern | ESTree.BindingPattern): ESTree.TSType | null {
  switch (parameter.type) {
    case "TSParameterProperty":
      return parameterType(parameter.parameter);
    case "RestElement":
      return parameter.typeAnnotation?.typeAnnotation ?? parameterType(parameter.argument);
    case "AssignmentPattern":
      return parameterType(parameter.left);
    default:
      return parameter.typeAnnotation?.typeAnnotation ?? null;
  }
}

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      objectParameter: "This parameter has the broad `object` type. Give it a named type that says what the function reads.",
    },
  },
  create(context) {
    const index = typeAliasIndex();
    const annotations: ESTree.TSType[] = [];
    // Some of these node types have no typed visitor key in oxlint, so the handler takes any node.
    function collect(node: ESTree.Node): void {
      if (!isFunctionLike(node)) return;
      for (const parameter of node.params) {
        const type = parameterType(parameter);
        if (type) annotations.push(type);
      }
    }
    return {
      ...index.visitor,
      ...Object.fromEntries([...functionTypes].map((type) => [type, collect])),
      "Program:exit"() {
        for (const type of annotations) {
          if (index.resolvesTo(type, "TSObjectKeyword")) context.report({ node: type, messageId: "objectParameter" });
        }
      },
    };
  },
});
