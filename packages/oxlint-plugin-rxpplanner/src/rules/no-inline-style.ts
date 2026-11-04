import { defineRule, type ESTree } from "@oxlint/plugins";
import { staticMethodCall } from "../ast.ts";
import { RESERVED_PROPERTY } from "../tokens.ts";

function staticText(node: ESTree.Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

function isFixed(node: ESTree.Node): boolean {
  if (node.type === "Literal") return true;
  if (node.type === "UnaryExpression") return node.argument.type === "Literal";
  return staticText(node) !== undefined;
}

const isOwnProperty = (name: string) => name.startsWith("--") && !RESERVED_PROPERTY.test(name);

// A message reads `{{name}}` as a placeholder, so the example, which has braces, goes in as data.
const literal = `vars={{ "--at-x": cond ? x : undefined }}`;

export default defineRule({
  meta: {
    type: "problem",
    messages: {
      inlineStyle:
        "A `style` or `vars` prop, `setProperty`, or `CSS.registerProperty` sets only the element's own custom properties (`--*`), each to a value that code computes, such as a place or a data color. A token name, or a name in a token family such as `--space-*`, belongs to `src/app/theme/tokens.css`. Every other property, and every fixed value, goes in the element's CSS class, which reads the custom property. A `style` or `vars` value must be an object literal written in the attribute, such as `{{literal}}`.",
    },
  },
  create(context) {
    const report = (node: ESTree.Node) => context.report({ node, messageId: "inlineStyle", data: { literal } });
    const checkName = (node: ESTree.Node) => {
      const name = staticText(node);
      if (name !== undefined && !isOwnProperty(name)) report(node);
    };
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !node.value) return;
        const prop = node.name.name;
        if (prop !== "style" && prop !== "vars") return;
        const style = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        if (style.type !== "ObjectExpression") return report(style);
        for (const property of style.properties) {
          if (property.type !== "Property") report(property);
          else if (!isOwnProperty(staticText(property.key) ?? "")) report(property.key);
          else if (isFixed(property.value)) report(property.value);
        }
      },
      CallExpression(node) {
        const method = staticMethodCall(node)?.name;
        if (method === "setProperty") {
          const [name, value] = node.arguments;
          if (name) checkName(name);
          if (value && isFixed(value)) report(value);
        } else if (method === "registerProperty" && node.arguments[0]?.type === "ObjectExpression") {
          for (const property of node.arguments[0].properties) {
            if (property.type === "Property" && property.key.type === "Identifier" && property.key.name === "name")
              checkName(property.value);
          }
        }
      },
    };
  },
});
