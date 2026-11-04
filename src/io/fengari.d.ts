declare module "fengari" {
  export const lua: any;
  export const lauxlib: any;
  export const lualib: any;
  export function to_luastring(text: string): Uint8Array;
  export function to_jsstring(bytes: Uint8Array): string;
}
