// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MARKS, type MarkKind } from "../rules/index.ts";
import { Mark } from "./Mark.tsx";

afterEach(() => cleanup());

it("draws every kind as an icon or a shape, not text, when the icon sheet lacks its texture", () => {
  const kinds = Object.keys(MARKS) as MarkKind[];
  const { container } = render(
    <>
      {kinds.map((kind) => (
        <Mark key={kind} mark={{ kind }} />
      ))}
    </>,
  );
  const marks = [...container.querySelectorAll(".mk")].map((mark) => [
    mark.textContent,
    mark.querySelector(":scope > .guide-icon.vector") !== null || mark.querySelectorAll("svg > *").length > 0,
  ]);
  expect(marks).toEqual(kinds.map(() => ["", true]));
});

it("draws a kind's vector icon without a catalog row, and the shape of a kind without one", () => {
  const { container } = render(
    <>
      <Mark mark={{ kind: "accept" }} />
      <Mark mark={{ kind: "equip" }} />
    </>,
  );
  const [accept, equip] = container.querySelectorAll(".mk");
  const icon = accept!.firstElementChild as HTMLElement;
  expect([accept!.className, icon.className, icon.style.getPropertyValue("--icon-url")]).toEqual([
    "mk mk-accept tex",
    "guide-icon vector",
    'url("/src/app/guideIcons/accept.svg?no-inline")',
  ]);
  expect([equip!.className, equip!.firstElementChild!.tagName]).toEqual(["mk mk-equip", "svg"]);
});
