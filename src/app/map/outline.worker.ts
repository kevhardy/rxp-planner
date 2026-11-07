import { groundPath, stackMasks, type OutlineReply, type OutlineRequest } from "./outline.ts";

const trace = ({ ground, stacks }: OutlineRequest): OutlineReply => ({
  width: ground.width,
  height: ground.height,
  path: groundPath(ground),
  masks: stackMasks(stacks, ground.width),
});

// The DOM types give `self` as a window; here it is the worker scope.
const port = self as {
  onmessage: (event: MessageEvent<OutlineRequest>) => void;
  postMessage(reply: OutlineReply): void;
};
port.onmessage = ({ data }) => {
  try {
    port.postMessage(trace(data));
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
