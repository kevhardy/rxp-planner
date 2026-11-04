import type { Context, ESTree, Scope, Variable } from "@oxlint/plugins";

type SourceCode = Context["sourceCode"];

export function resolveReference(sourceCode: SourceCode, identifier: ESTree.Node): Variable | null {
  for (let scope: Scope | null = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const reference = scope.references.find((candidate) => candidate.identifier.start === identifier.start);
    if (reference) return reference.resolved;
  }
  return null;
}

export function isGlobal(sourceCode: SourceCode, identifier: Extract<ESTree.Node, { type: "Identifier" }>): boolean {
  if (sourceCode.isGlobalReference(identifier)) return true;
  for (let scope: Scope | null = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable.defs.length === 0;
  }
  return true;
}

export function isReassigned(variable: Variable): boolean {
  return variable.references.some((reference) => reference.isWrite() && !reference.init);
}

export function constDeclarator(variable: Variable): { declarator: ESTree.VariableDeclarator; init: ESTree.Expression } | null {
  if (isReassigned(variable)) return null;
  for (const { node, parent } of variable.defs) {
    if (node.type === "VariableDeclarator" && parent?.type === "VariableDeclaration" && parent.kind === "const" && node.init) {
      return { declarator: node, init: node.init };
    }
  }
  return null;
}
