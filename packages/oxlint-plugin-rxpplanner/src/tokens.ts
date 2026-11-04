import { readFileSync } from "node:fs";
import { reservedProperty } from "../../../src/app/theme/reservedProperty.ts";

export const RESERVED_PROPERTY = reservedProperty(readFileSync(new URL("../../../src/app/theme/tokens.css", import.meta.url), "utf8"));
