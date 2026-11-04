import { fetchDatasetArtifact, type DatasetArtifact, type DatasetLocation } from "../data/dataset.ts";
import type { LoadedDataset } from "../data/index.ts";
import { Latest, type Status } from "./async.ts";

/** `data` is null before `select`, while loading, and after a failure; `error` tells the last case apart. */
export interface DatasetState {
  data: LoadedDataset | null;
  error?: string | undefined;
}

const NONE: DatasetState = { data: null };

export class DatasetStore {
  readonly #artifact = new Latest<DatasetArtifact>((artifact) => artifact.dispose());
  #location: DatasetLocation | undefined;
  #read: { status: Status<DatasetArtifact>; state: DatasetState } | undefined;

  subscribe = this.#artifact.subscribe;

  getState = (): DatasetState => {
    const status = this.#artifact.getState();
    if (this.#read?.status !== status) {
      const state =
        status.kind === "ready" ? { data: status.value.data } : status.kind === "failed" ? { data: null, error: status.error } : NONE;
      this.#read = { status, state };
    }
    return this.#read.state;
  };

  select(location: DatasetLocation): void {
    this.#location = location;
    this.#artifact.run((signal) => fetchDatasetArtifact(location, signal));
  }

  retry(): void {
    if (this.#location) this.select(this.#location);
  }

  clear(): void {
    this.#artifact.clear();
  }
}
