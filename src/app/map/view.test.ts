import { describe, expect, it } from "vitest";
import { CanvasView } from "./view.ts";

const zone = { left: 10, top: 20, width: 30, height: 40 };
const other = { left: 50, top: 20, width: 30, height: 40 };
const at = (x: number) => ({ x, y: 50, width: 10 });

describe("CanvasView", () => {
  it("keeps the view for an equal fit in a new object, and moves for another place", () => {
    const view = new CanvasView();
    expect(view.move({ fit: zone })).toEqual({ fit: zone });
    expect(view.move({ fit: { ...zone } })).toBeNull();
    expect(view.move({ fit: other })).toEqual({ fit: other });
  });

  it("shows an equal fit again for a new id, and keeps the view while the fit changes under one id", () => {
    const view = new CanvasView();
    expect(view.move({ id: "route 1", fit: zone })).toEqual({ fit: zone });
    expect(view.move({ id: "route 1", fit: other })).toBeNull();
    expect(view.move({ id: "route 2", fit: other })).toEqual({ fit: other });
    expect(view.move({ fit: other })).toEqual({ fit: other });
  });

  it("keeps the view for a new id with no fit, and moves when a fit arrives or leaves", () => {
    const view = new CanvasView();
    expect(view.move({ id: "route 1" })).toEqual({ fit: undefined });
    expect(view.move({ id: "route 2" })).toBeNull();
    expect(view.move({ id: "route 2", fit: zone })).toEqual({ fit: zone });
    expect(view.move({ id: "route 2", fit: other })).toBeNull();
    expect(view.move({ id: "route 2" })).toEqual({ fit: undefined });
  });

  it("holds the view while following pauses, and moves again on the next request", () => {
    const view = new CanvasView();
    expect(view.move({ id: "follow 1", fit: at(20) })).toEqual({ fit: at(20) });
    expect(view.move({ id: "follow 1", fit: at(20), hold: true })).toBeNull();
    expect(view.move({ id: "reveal 1", fit: at(70) })).toEqual({ fit: at(70) });
    expect(view.move({ id: "follow 1", fit: at(20), hold: true })).toBeNull();
    expect(view.move({ id: "follow 2", fit: at(30) })).toEqual({ fit: at(30) });
  });

  it("moves a new canvas to a held request's fit", () => {
    expect(new CanvasView().move({ id: "follow 3", fit: at(40), hold: true })).toEqual({ fit: at(40) });
  });

  it("shows its start frame first, whatever the request", () => {
    const view = new CanvasView(other);
    expect(view.move({ id: "follow 3", fit: at(40), hold: true })).toEqual({ frame: other });
    expect(view.move({ id: "follow 3", fit: at(40), hold: true })).toBeNull();
  });
});
