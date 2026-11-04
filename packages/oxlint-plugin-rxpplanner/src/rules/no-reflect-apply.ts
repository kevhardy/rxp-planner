import { reflectCallRule } from "../reflect.ts";

export default reflectCallRule("apply", "Call the function directly instead of through `Reflect.apply`, so its types are checked.");
