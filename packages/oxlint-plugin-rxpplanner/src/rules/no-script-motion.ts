import { defineRule, type Context, type ESTree, type Scope } from "@oxlint/plugins";
import { unwrapExpression } from "../ast.ts";
import { isGlobal } from "../scope.ts";

const CONSTRUCTORS = new Set(["Animation", "KeyframeEffect", "DocumentTimeline", "ScrollTimeline", "ViewTimeline"]);
const METHODS = new Set(["animate", "updateTiming", "startViewTransition"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
// The animation elements of SVG 2's Animation chapter.
const SVG_ANIMATIONS = new Set(["animate", "animateMotion", "animateTransform", "discard", "set"]);
// `auto` takes the CSS `scroll-behavior`, which stylelint holds to `auto`.
const INSTANT_SCROLLS = new Set(["auto", "instant"]);
// The scope manager records a type's name as a reference too, and a type starts no motion.
const TYPE_POSITIONS = new Set(["TSTypeReference", "TSTypeQuery", "TSQualifiedName", "TSClassImplements", "TSInterfaceHeritage"]);

function keyName(key: ESTree.Node, computed: boolean): string | null {
  if (key.type === "Identifier" && !computed) return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && computed && key.expressions.length === 0) return key.quasis[0]?.value.cooked ?? null;
  return null;
}

function isGlobalValue(sourceCode: Context["sourceCode"], node: ESTree.IdentifierReference): boolean {
  if (TYPE_POSITIONS.has(node.parent.type)) return false;
  for (let scope: Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
    const reference = scope.references.find((candidate) => candidate.identifier.start === node.start);
    if (reference) return reference.resolved === null || reference.resolved.defs.length === 0;
  }
  return false;
}

function isGlobalObject(sourceCode: Context["sourceCode"], node: ESTree.Node | null): boolean {
  const object = node && unwrapExpression(node);
  return object?.type === "Identifier" && GLOBAL_OBJECTS.has(object.name) && isGlobal(sourceCode, object);
}

function patternSource(pattern: ESTree.ObjectPattern | ESTree.ObjectAssignmentTarget): ESTree.Node | null {
  const holder = pattern.parent;
  if (holder.type === "VariableDeclarator") return holder.init;
  if ((holder.type === "AssignmentExpression" || holder.type === "AssignmentPattern") && holder.left === pattern) return holder.right;
  return null;
}

const isInstantScroll = (value: ESTree.Node) =>
  value.type === "Literal" && typeof value.value === "string" && INSTANT_SCROLLS.has(value.value);

export default defineRule({
  meta: {
    type: "problem",
    messages: {
      scriptMotion:
        'Reduced motion does not reach motion that script or SVG starts. Animate in CSS with the motion tokens, which reduced motion sets to 0ms, and scroll with `behavior: "auto"`.',
    },
  },
  create(context) {
    return {
      Identifier(node: ESTree.IdentifierReference) {
        // A shorthand property's key shares its value's position, so only the value reports.
        if (node.parent.type === "Property" && node.parent.key === node) return;
        if (CONSTRUCTORS.has(node.name) && isGlobalValue(context.sourceCode, node)) context.report({ node, messageId: "scriptMotion" });
      },
      MemberExpression(node: ESTree.MemberExpression) {
        const name = keyName(node.property, node.computed);
        if (name === null) return;
        if (METHODS.has(name) || (CONSTRUCTORS.has(name) && isGlobalObject(context.sourceCode, node.object)))
          context.report({ node, messageId: "scriptMotion" });
      },
      Property(node: ESTree.ObjectProperty | ESTree.BindingProperty) {
        const name = keyName(node.key, node.computed);
        if (name === null) return;
        if (node.parent.type === "ObjectPattern") {
          if (METHODS.has(name) || (CONSTRUCTORS.has(name) && isGlobalObject(context.sourceCode, patternSource(node.parent))))
            context.report({ node, messageId: "scriptMotion" });
        } else if (name === "behavior" && !isInstantScroll(node.value)) {
          context.report({ node, messageId: "scriptMotion" });
        }
      },
      AssignmentExpression(node: ESTree.AssignmentExpression) {
        const target = node.left;
        if (target.type === "MemberExpression" && keyName(target.property, target.computed) === "behavior" && !isInstantScroll(node.right))
          context.report({ node, messageId: "scriptMotion" });
      },
      JSXOpeningElement(node: ESTree.JSXOpeningElement) {
        if (node.name.type === "JSXIdentifier" && SVG_ANIMATIONS.has(node.name.name)) context.report({ node, messageId: "scriptMotion" });
      },
      CallExpression(node: ESTree.CallExpression) {
        const callee = unwrapExpression(node.callee);
        const element = node.arguments[1];
        if (
          callee.type === "MemberExpression" &&
          keyName(callee.property, callee.computed) === "createElementNS" &&
          element?.type === "Literal" &&
          typeof element.value === "string" &&
          SVG_ANIMATIONS.has(element.value)
        )
          context.report({ node, messageId: "scriptMotion" });
      },
    };
  },
});
