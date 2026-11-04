import { definePlugin } from "@oxlint/plugins";
import noArrayFilterMap from "./rules/no-array-filter-map.ts";
import noChainedTypeAssertions from "./rules/no-chained-type-assertions.ts";
import noCommandTables from "./rules/no-command-tables.ts";
import noConditionalEmptyObjectSpread from "./rules/no-conditional-empty-object-spread.ts";
import noEventTargetAssertions from "./rules/no-event-target-assertions.ts";
import noObjectParameters from "./rules/no-object-parameters.ts";
import noInlineStyle from "./rules/no-inline-style.ts";
import noRawControl from "./rules/no-raw-control.ts";
import noRawColor from "./rules/no-raw-color.ts";
import noReduceAccumulatorCopy from "./rules/no-reduce-accumulator-copy.ts";
import noReflectApply from "./rules/no-reflect-apply.ts";
import noReflectGet from "./rules/no-reflect-get.ts";
import noScriptMotion from "./rules/no-script-motion.ts";
import noStringOfCaughtError from "./rules/no-string-of-caught-error.ts";
import noUnknownTypeAliases from "./rules/no-unknown-type-aliases.ts";
import noWidenThenAssert from "./rules/no-widen-then-assert.ts";
import requireDisableReason from "./rules/require-disable-reason.ts";

export default definePlugin({
  meta: { name: "rxpplanner" },
  rules: {
    "no-array-filter-map": noArrayFilterMap,
    "no-chained-type-assertions": noChainedTypeAssertions,
    "no-command-tables": noCommandTables,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpread,
    "no-event-target-assertions": noEventTargetAssertions,
    "no-object-parameters": noObjectParameters,
    "no-inline-style": noInlineStyle,
    "no-raw-control": noRawControl,
    "no-raw-color": noRawColor,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopy,
    "no-reflect-apply": noReflectApply,
    "no-reflect-get": noReflectGet,
    "no-script-motion": noScriptMotion,
    "no-string-of-caught-error": noStringOfCaughtError,
    "no-unknown-type-aliases": noUnknownTypeAliases,
    "no-widen-then-assert": noWidenThenAssert,
    "require-disable-reason": requireDisableReason,
  },
});
