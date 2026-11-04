export interface GuideRecord {
  id: string;
  /** Guide text as RXP reads it from `RegisterGuide`. */
  text: string;
  /** Group and default arguments of a Lua `RegisterGuide` call. */
  registerArgs?: RegisterArgs;
  fileName?: string;
  order: number;
}

/** Arguments that `RegisterGuide(group, text, defaultFor)` passes besides the text. */
export interface RegisterArgs {
  group: string;
  defaultFor?: string;
}
