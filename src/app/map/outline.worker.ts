import { eachMask, groundPath, stackMasks, type OutlineReply, type OutlineRequest } from "./outline.ts";

async function png(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function trace({ ground, stacks }: OutlineRequest): Promise<OutlineReply> {
  const { width, height } = ground;
  const pngs = eachMask(stackMasks(stacks, width), (rgba) => png(rgba, width, height));
  const [two, more, twoEdge, moreEdge] = await Promise.all([pngs.two, pngs.more, pngs.twoEdge, pngs.moreEdge]);
  return { width, height, path: groundPath(ground), masks: { two, more, twoEdge, moreEdge } };
}

// The DOM types give `self` as a window; here it is the worker scope.
const port = self as {
  onmessage: (event: MessageEvent<OutlineRequest>) => void;
  postMessage(reply: OutlineReply): void;
};
port.onmessage = ({ data }) => {
  trace(data).then(
    (found) => port.postMessage(found),
    (error: unknown) => port.postMessage({ error: error instanceof Error ? error.message : String(error) }),
  );
};
