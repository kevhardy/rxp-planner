import { describe, expect, it } from "vitest";
import { conditionRows, conditionRowsText, parseCondition, type ConditionLiteral } from "./condition.ts";
import type { ConditionExpr } from "./model.ts";

const parse = (text: string): ConditionExpr => parseCondition(text).expr;
const t = (value: string): ConditionExpr => ({ type: "token", value });
const not = (item: ConditionExpr): ConditionExpr => ({ type: "not", item });
const and = (...items: ConditionExpr[]): ConditionExpr => ({ type: "and", items });
const or = (...items: ConditionExpr[]): ConditionExpr => ({ type: "or", items });

function evaluate(expr: ConditionExpr, truths: ReadonlySet<string>): boolean {
  switch (expr.type) {
    case "token":
      return truths.has(expr.value);
    case "invalid":
      return false;
    case "not":
      return !evaluate(expr.item, truths);
    case "and":
      return expr.items.every((item) => evaluate(item, truths));
    case "or":
      return expr.items.some((item) => evaluate(item, truths));
  }
}

const characters = [
  [],
  ["Alliance", "Warlock"],
  ["Alliance", "Mage", "Human"],
  ["Alliance", "Mage", "Gnome"],
  ["Horde", "Rogue"],
  ["Horde", "Warlock", "Human"],
].map((c) => new Set(c));

describe("parseCondition", () => {
  it("reads tokens, AND lists, and OR alternatives", () => {
    expect(parse("Mage")).toEqual(t("Mage"));
    expect(parse("Human Mage")).toEqual(and(t("Human"), t("Mage")));
    expect(parse("Undead Rogue/Undead Warrior")).toEqual(or(and(t("Undead"), t("Rogue")), and(t("Undead"), t("Warrior"))));
  });

  it("negates tokens and groups", () => {
    expect(parse("!Warrior !Druid")).toEqual(and(not(t("Warrior")), not(t("Druid"))));
    expect(parse("!(Human Mage)")).toEqual(not(and(t("Human"), t("Mage"))));
    expect(parse("! Mage")).toEqual(t("Mage"));
    expect(parse("!!Mage")).toEqual(not(t("Mage")));
  });

  it("ends a group at the first ), as RXP does", () => {
    expect(parse("Alliance (Mage (Human/Warlock))")).toEqual(and(t("Alliance"), or(and(t("Mage"), t("Human")), t("Warlock"))));
    expect(parse("(Mage")).toEqual(t("Mage"));
  });

  it("trims group text", () => {
    expect(parse("(Mage/ )")).toEqual(t("Mage"));
    expect(parse("()")).toEqual(or());
  });

  it("marks a group joined to a token as invalid", () => {
    expect(parse("Mage(Human) Alliance")).toEqual(and({ type: "invalid", text: "Mage(Human)" }, t("Alliance")));
    expect(parse("!Mage!(Human)")).toEqual(not({ type: "invalid", text: "Mage!(Human)" }));
    expect(parse("!(Mage)Human")).toEqual({ type: "invalid", text: "!(Mage)Human" });
  });

  it("reads any number of groups", () => {
    const text = "(Mage) ".repeat(6400) + "(Rogue)";
    const mage = new Set(["Mage"]);
    expect(evaluate(parse(text), mage)).toBe(false);
    expect(evaluate(parse(text), new Set(["Mage", "Rogue"]))).toBe(true);
    const joined = parse("(Mage) ".repeat(6400) + "Mage(Rogue)");
    expect(joined.type === "and" && joined.items.at(-1)).toEqual({ type: "invalid", text: "Mage(Rogue)" });
  });

  it("treats skip as an ordinary token", () => {
    expect(parseCondition(" skip ")).toEqual({ text: "skip", expr: t("skip") });
    expect(parseCondition("<< skip").expr).toEqual(t("skip"));
  });

  it("treats other characters as separators, as RXP does", () => {
    expect(parse("Rogue/Druid    #optional")).toEqual(or(t("Rogue"), and(t("Druid"), t("optional"))));
    expect(parse("Night_Elf")).toEqual(and(t("Night"), t("Elf")));
    expect(parse("A\uE000B")).toEqual(and(t("A"), t("B")));
  });

  it("reads a private-use character as a space", () => {
    expect(parse("(\uE000)")).toEqual(or());
    expect(parse("(\u00A0\uE000\u00A0)")).toEqual(and());
    expect(parse("A(\uE000)")).toEqual({ type: "invalid", text: "A( )" });
  });

  it("drops empty alternatives but keeps blank ones", () => {
    expect(parse("Mage//Rogue/")).toEqual(or(t("Mage"), t("Rogue")));
    expect(parse("Mage/ /Rogue")).toEqual(or(t("Mage"), and(), t("Rogue")));
  });

  it.each<[string, boolean[]]>([
    ["Alliance (Mage (Human/Warlock))", [false, true, true, false, false, false]],
    ["(Mage/ )", [false, false, true, true, false, false]],
    ["(Mage/ /Rogue) Horde", [false, false, false, false, true, true]],
    ["!(Human Mage)/Rogue", [true, true, false, true, true, true]],
    ["!(Alliance/ )", [true, false, false, false, true, true]],
    ["Mage(Human)/Rogue", [false, false, false, false, true, false]],
    ["!Mage(Human)", [true, true, true, true, true, true]],
    ["()/Rogue", [false, false, false, false, true, false]],
    ["!()", [true, true, true, true, true, true]],
    ["Warlock/Mage/ /", [true, true, true, true, true, true]],
    ["((Mage) Human)", [false, false, true, false, false, false]],
    ["!!(Mage)", [false, false, true, true, false, false]],
  ])("gives %s the meaning RXP gives it", (text, expected) => {
    expect(characters.map((truths) => evaluate(parse(text), truths))).toEqual(expected);
  });
});

const yes = (token: string): ConditionLiteral => ({ token, not: false });
const no = (token: string): ConditionLiteral => ({ token, not: true });

describe("conditionRows", () => {
  it("reads alternatives of tokens and negated tokens", () => {
    expect(conditionRows(parse("Human Warrior/Dwarf !Hunter"))).toEqual([
      [yes("Human"), yes("Warrior")],
      [yes("Dwarf"), no("Hunter")],
    ]);
    expect(conditionRows(parse("!Mage"))).toEqual([[no("Mage")]]);
  });

  it("gives no rows for an empty condition", () => {
    expect(conditionRows(parse(""))).toEqual([]);
  });

  it("gives null for a group or a blank alternative", () => {
    expect(conditionRows(parse("!(Human/Dwarf)"))).toBeNull();
    expect(conditionRows(parse("Alliance (Mage/Warlock)"))).toBeNull();
    expect(conditionRows(parse("Human/ /Orc"))).toBeNull();
  });
});

describe("conditionRowsText", () => {
  it("writes rows as alternatives of tokens", () => {
    expect(
      conditionRowsText([
        [yes("Human"), yes("Warrior")],
        [yes("Dwarf"), no("Hunter")],
      ]),
    ).toBe("Human Warrior/Dwarf !Hunter");
    expect(conditionRowsText([[no("Orc"), yes("Mage")]])).toBe("!Orc Mage");
  });

  it("drops an emptied row", () => {
    expect(conditionRowsText([[yes("Orc")], []])).toBe("Orc");
    expect(conditionRowsText([[]])).toBe("");
  });
});
