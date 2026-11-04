import type { ESTree } from "@oxlint/plugins";

type Keyword = "TSObjectKeyword" | "TSUnknownKeyword";

interface Binding {
  type: ESTree.TSType;
  env: Env;
}
type Env = ReadonlyMap<string, Binding>;

const typeScopeTypes = new Set(["Program", "BlockStatement", "TSModuleBlock", "StaticBlock", "SwitchStatement"]);

function typeScopeOf(node: ESTree.Node): ESTree.Node | null {
  for (let current = node.parent; current; current = current.parent) if (typeScopeTypes.has(current.type)) return current;
  return null;
}

export function typeAliasIndex() {
  const declarations = new Map<ESTree.Node, Map<string, ESTree.Node[]>>();
  const inferNames = new Map<ESTree.Node, Set<string>>();
  const aliases: ESTree.TSTypeAliasDeclaration[] = [];

  function declare(node: ESTree.Node, name: string): void {
    const scope = typeScopeOf(node);
    if (!scope) return;
    const names = declarations.get(scope) ?? new Map<string, ESTree.Node[]>();
    declarations.set(scope, names);
    names.set(name, [...(names.get(name) ?? []), node]);
  }

  function declareClass(node: ESTree.Class): void {
    if (node.id) declare(node, node.id.name);
  }

  function declareImport(node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier): void {
    declare(node, node.local.name);
  }

  function isTypeParameterInScope(reference: ESTree.Node, name: string): boolean {
    let child = reference;
    for (let node = reference.parent; node; child = node, node = node.parent) {
      if ("typeParameters" in node && node.typeParameters?.params.some((parameter) => parameter.name.name === name)) return true;
      if (node.type === "TSMappedType" && node.key.name === name && (child === node.nameType || child === node.typeAnnotation)) return true;
      if (node.type === "TSConditionalType" && child === node.trueType && inferNames.get(node)?.has(name)) return true;
    }
    return false;
  }

  function lookUpAlias(reference: ESTree.Node, name: string): ESTree.TSTypeAliasDeclaration | null {
    for (let scope = typeScopeOf(reference); scope; scope = typeScopeOf(scope)) {
      const found = declarations.get(scope)?.get(name);
      if (!found) continue;
      const [only] = found;
      return found.length === 1 && only?.type === "TSTypeAliasDeclaration" ? only : null;
    }
    return null;
  }

  function bindArguments(alias: ESTree.TSTypeAliasDeclaration, args: ESTree.TSType[], callerEnv: Env): Env | null {
    const env = new Map(callerEnv);
    for (const [index, parameter] of (alias.typeParameters?.params ?? []).entries()) {
      const argument = args[index];
      if (argument) env.set(parameter.name.name, { type: argument, env: callerEnv });
      else if (parameter.default) env.set(parameter.name.name, { type: parameter.default, env: new Map(env) });
      else return null;
    }
    return env;
  }

  function resolvesTo(type: ESTree.TSType, keyword: Keyword, env: Env = new Map(), path: ReadonlySet<ESTree.Node> = new Set()): boolean {
    if (type.type === keyword) return true;
    switch (type.type) {
      case "TSParenthesizedType":
        return resolvesTo(type.typeAnnotation, keyword, env, path);
      case "TSUnionType":
        return type.types.some((member) => resolvesTo(member, keyword, env, path));
      case "TSTypeReference": {
        if (type.typeName.type !== "Identifier") return false;
        const name = type.typeName.name;
        const bound = type.typeArguments ? undefined : env.get(name);
        if (bound) return resolvesTo(bound.type, keyword, bound.env, path);
        if (isTypeParameterInScope(type, name)) return false;
        const alias = lookUpAlias(type, name);
        if (!alias || path.has(alias)) return false;
        const aliasEnv = bindArguments(alias, type.typeArguments?.params ?? [], env);
        return aliasEnv !== null && resolvesTo(alias.typeAnnotation, keyword, aliasEnv, new Set([...path, alias]));
      }
      default:
        return false;
    }
  }

  const visitor = {
    TSTypeAliasDeclaration(node: ESTree.TSTypeAliasDeclaration) {
      aliases.push(node);
      declare(node, node.id.name);
    },
    TSInterfaceDeclaration(node: ESTree.TSInterfaceDeclaration) {
      declare(node, node.id.name);
    },
    TSEnumDeclaration(node: ESTree.TSEnumDeclaration) {
      declare(node, node.id.name);
    },
    ClassDeclaration: declareClass,
    ClassExpression: declareClass,
    ImportSpecifier: declareImport,
    ImportDefaultSpecifier: declareImport,
    ImportNamespaceSpecifier: declareImport,
    // An `infer` name is visible in the true branch of each conditional type whose `extends` clause holds it.
    TSInferType(node: ESTree.TSInferType) {
      let child: ESTree.Node = node;
      for (let current: ESTree.Node | null = node.parent; current; child = current, current = current.parent) {
        if (current.type !== "TSConditionalType" || child !== current.extendsType) continue;
        const names = inferNames.get(current) ?? new Set<string>();
        inferNames.set(current, names.add(node.typeParameter.name.name));
      }
    },
  };

  return { visitor, aliases, resolvesTo };
}
