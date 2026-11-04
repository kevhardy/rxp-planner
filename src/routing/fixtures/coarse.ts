import type { Point } from "../frame.ts";
import { CELL_PIXELS, type Terrain } from "../terrain.ts";

export const COARSE_DIR = `${import.meta.dirname}/artifact-coarse/`;

const cell = (x: number, y: number): Point => [CELL_PIXELS * x + CELL_PIXELS / 2, CELL_PIXELS * y + CELL_PIXELS / 2];

export const COARSE_PLACES = {
  plateau: cell(10, 64),
  lowland: cell(70, 40),
  south: cell(70, 138),
  court: cell(82, 70),
  pit: cell(75, 11),
  shore: cell(120, 64),
  east: cell(296, 64),
  underDeck: cell(68, 127),
} as const;

export const UNDER_DECK_HEIGHT = 0;

export const withoutCoarse = (terrain: Terrain): Terrain => ({ frame: terrain.frame, bounds: terrain.bounds, region: terrain.region });
