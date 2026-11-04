import { defineRule } from "@oxlint/plugins";
import { typeAliasIndex } from "../typeAliases.ts";

export default defineRule({
  meta: {
    type: "suggestion",
    messages: {
      unknownAlias: "This alias hides `unknown`. Write `unknown` where the value enters, so readers see that it is unchecked.",
    },
  },
  create(context) {
    const index = typeAliasIndex();
    return {
      ...index.visitor,
      "Program:exit"() {
        for (const alias of index.aliases) {
          if (index.resolvesTo(alias.typeAnnotation, "TSUnknownKeyword")) context.report({ node: alias.id, messageId: "unknownAlias" });
        }
      },
    };
  },
});
