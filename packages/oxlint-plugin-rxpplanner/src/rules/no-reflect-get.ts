import { reflectCallRule } from "../reflect.ts";

export default reflectCallRule("get", "Read the property directly instead of through `Reflect.get`, so its type is checked.");
