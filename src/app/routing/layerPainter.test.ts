import { describe, expect, it, vi } from "vitest";
import { at as atPixel } from "../../routing/fixtures/region.ts";
import { createPlan } from "../../routing/plan.ts";
import { layerKey, layerPainter, type LayerReply, type LayerTile, type LayerWorker } from "./layerPainter.ts";

function fakeWorkers() {
  const workers: (LayerWorker & { sent: string[] })[] = [];
  const create = () => {
    const w: LayerWorker & { sent: string[] } = {
      sent: [],
      postMessage: (request) => w.sent.push(request.key),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    workers.push(w);
    return w;
  };
  const answer = (url: string, w = workers.at(-1)!) => w.onmessage!({ data: { key: w.sent.at(-1)!, url } } as MessageEvent<LayerReply>);
  return { workers, create, answer };
}

const at = (x: number, layer: LayerTile["layer"] = "floors"): LayerTile => ({ map: 0, tile: [x, 0], layer, maxSlope: 50 });

describe("layerPainter", () => {
  it("keys the slope only for the steep layer and a search layer, and a search by its id", () => {
    const search = { id: "k3x", plan: createPlan(atPixel([0, 0]), atPixel([9, 9]), ""), mode: "Run", leg: 0, stop: 0, walks: [] };
    expect([layerKey(at(1)), layerKey(at(1, "steep")), layerKey({ ...at(1, "explored"), search })]).toEqual([
      "0/1,0/floors",
      "0/1,0/steep/50",
      "0/1,0/explored/50/k3x",
    ]);
  });

  it("paints one tile at a time, in order, and only the tiles that the last call wants", () => {
    const { workers, create, answer } = fakeWorkers();
    const painter = layerPainter(create);
    const painted = vi.fn();
    painter.subscribe(painted);
    painter.want([at(1), at(2), at(3)]);
    expect(workers[0]!.sent).toEqual(["0/1,0/floors"]);
    painter.want([at(4), at(1)]);
    answer("data:one");
    expect(painter.image("0/1,0/floors")).toBe("data:one");
    expect(painted).toHaveBeenCalledTimes(1);
    expect(workers[0]!.sent).toEqual(["0/1,0/floors", "0/4,0/floors"]);
    answer("");
    expect(painter.image("0/4,0/floors")).toBe("");
    expect(workers[0]!.sent).toHaveLength(2);
  });

  it("keeps the newest images, and a wanted image counts as new", () => {
    const { create, answer } = fakeWorkers();
    const painter = layerPainter(create, 2);
    for (const x of [1, 2]) {
      painter.want([at(x)]);
      answer(`data:${x}`);
    }
    painter.want([at(1)]);
    painter.want([at(3)]);
    answer("data:3");
    expect([1, 2, 3].map((x) => painter.image(layerKey(at(x))))).toEqual(["data:1", undefined, "data:3"]);
  });

  it("paints a tile again after its paint failed, when a later call wants it", () => {
    const { workers, create, answer } = fakeWorkers();
    const painter = layerPainter(create);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    painter.want([at(1)]);
    workers[0]!.onmessage!({ data: { key: "0/1,0/floors", url: "", error: "offline" } } as MessageEvent<LayerReply>);
    expect(painter.image("0/1,0/floors")).toBeUndefined();
    painter.want([at(1)]);
    answer("data:one");
    expect([workers[0]!.sent, painter.image("0/1,0/floors")]).toEqual([["0/1,0/floors", "0/1,0/floors"], "data:one"]);
  });

  it("starts a new worker after a worker fails, and after release", () => {
    const { workers, create } = fakeWorkers();
    const painter = layerPainter(create);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    painter.want([at(1), at(2)]);
    workers[0]!.onerror!({ message: "boom" } as ErrorEvent);
    expect(workers[0]!.terminate).toHaveBeenCalled();
    expect(painter.image("0/1,0/floors")).toBeUndefined();
    expect(workers[1]!.sent).toEqual(["0/2,0/floors"]);
    painter.release();
    expect(workers[1]!.terminate).toHaveBeenCalled();
    painter.want([at(2)]);
    expect(workers[2]!.sent).toEqual(["0/2,0/floors"]);
  });
});
