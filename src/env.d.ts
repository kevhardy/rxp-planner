// Each version is the JSON of a `Version` from `src/app/version.ts`. Vitest turns an `import.meta.env` value that is not
// a string into "[object Object]".
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  /** Undefined when the dev server starts without a dataset. */
  readonly VITE_DATASET_VERSION: string | undefined;
  /** Undefined when the dev server starts without a dataset. */
  readonly VITE_DATASET_MANIFEST_HASH: string | undefined;
}
