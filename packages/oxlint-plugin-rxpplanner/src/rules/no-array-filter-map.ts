import { defineRule } from "@oxlint/plugins";
import { isKnownArray } from "../arrays.ts";
import { staticMethodCall, unwrapExpression } from "../ast.ts";

const opposite = new Map([
  ["map", "filter"],
  ["filter", "map"],
]);

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      twoPasses: "This chain walks the array twice with `filter` and `map`. Use one `flatMap` or `reduce`, or a lazy iterator.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const outer = staticMethodCall(node);
        const innerName = outer && opposite.get(outer.name);
        if (!outer || !innerName) return;
        const innerCall = unwrapExpression(outer.receiver);
        if (innerCall.type !== "CallExpression") return;
        const inner = staticMethodCall(innerCall);
        if (inner?.name === innerName && isKnownArray(context.sourceCode, inner.receiver)) context.report({ node, messageId: "twoPasses" });
      },
    };
  },
});
