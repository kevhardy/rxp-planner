import { defineRule, type ESTree } from "@oxlint/plugins";

const RAW_COLOR =
  /(?<!\w)#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk)\(/i;

const NAMES =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen";
const NAMED_COLOR = new RegExp(String.raw`(?<![\w-])(?:${NAMES.replaceAll(" ", "|")})(?![\w-])`, "i");
// A capitalized word such as "Gold" is a label far more often than a color.
const LOWERCASE_NAMED_VALUE = new RegExp(String.raw`^\s*(?:${NAMES.replaceAll(" ", "|")})\s*$`);
const COLOR_ATTRIBUTES = new Set(["fill", "stroke", "color", "stopColor", "floodColor", "lightingColor"]);
const COLOR_PROPERTY = /colou?r$|^(?:background|border|outline|fill|stroke|box-?shadow|text-?shadow)/i;

function text(node: ESTree.Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis.map(({ value }) => value.cooked ?? value.raw).join(" ");
  return undefined;
}

export default defineRule({
  meta: {
    type: "problem",
    messages: {
      rawColor:
        "Use a color token from `src/app/theme/tokens.css`, such as `var(--text)`, so the color follows the theme. Code that must build a color string does it in `src/app/theme/colors.ts`.",
    },
  },
  create(context) {
    const named = (value: ESTree.JSXAttributeValue | ESTree.Expression | null) => {
      const node = value?.type === "JSXExpressionContainer" ? value.expression : value;
      const string = node ? text(node) : undefined;
      if (node && string !== undefined && !LOWERCASE_NAMED_VALUE.test(string) && NAMED_COLOR.test(string))
        context.report({ node, messageId: "rawColor" });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string" && (RAW_COLOR.test(node.value) || LOWERCASE_NAMED_VALUE.test(node.value))) {
          context.report({ node, messageId: "rawColor" });
        }
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && LOWERCASE_NAMED_VALUE.test(text(node)!)) context.report({ node, messageId: "rawColor" });
      },
      TemplateElement(node) {
        if (RAW_COLOR.test(node.value.cooked ?? node.value.raw)) context.report({ node, messageId: "rawColor" });
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (COLOR_ATTRIBUTES.has(node.name.name)) named(node.value);
        const style =
          (node.name.name === "style" || node.name.name === "vars") && node.value?.type === "JSXExpressionContainer"
            ? node.value.expression
            : undefined;
        if (style?.type !== "ObjectExpression") return;
        for (const property of style.properties) {
          if (property.type !== "Property") continue;
          const key = property.key.type === "Identifier" ? property.key.name : text(property.key);
          if (key !== undefined && (key.startsWith("--") || COLOR_PROPERTY.test(key))) named(property.value);
        }
      },
    };
  },
});
