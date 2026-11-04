import type { Rgba } from "../../routing/layers.ts";

export const rgbaColor = ([r, g, b, a]: Rgba): string => `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(2)})`;
