import { defineRule } from "@oxlint/plugins";

const RAW = new Set(["button", "input", "select", "textarea"]);

export default defineRule({
  meta: {
    type: "problem",
    messages: {
      rawControl:
        "Use a primitive from `src/app/ui/`, so each control has the app's one look for its role: `Button`, `IconButton`, `Segmented`, `MenuItem`, `Tab`, `ItemButton`, `MarkButton`, or `ArtButton` for a button; `Input`, `Checkbox`, `Radio`, `Slider`, or `FileInput` for an input; `Select`; or `TextArea`.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && RAW.has(node.name.name)) context.report({ node, messageId: "rawControl" });
      },
    };
  },
});
