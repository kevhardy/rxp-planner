import { defineRule } from "@oxlint/plugins";

const DISABLE_DIRECTIVE = /^(?:oxlint|eslint)-disable(?:-next-line|-line)?(?=\s|$)/;
const REASON = /\s--\s+\S/;

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      missingReason:
        "Give this suppression its reason after ` -- ` on the same line, such as `// oxlint-disable-next-line <rule> -- <reason>`.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const [line = ""] = comment.value.trimStart().split("\n");
          if (DISABLE_DIRECTIVE.test(line) && !REASON.test(line)) context.report({ node: comment, messageId: "missingReason" });
        }
      },
    };
  },
});
