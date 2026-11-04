import { useSyncExternalStore } from "react";
import { PlaybackRouting, type Playback, type PlaybackInput, type PlaybackMoment, type WayRouter } from "../../routing/playback.ts";
import type { SimState } from "../../rules/index.ts";
import { useStores } from "../context.ts";

export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
export type Speed = (typeof SPEEDS)[number];

export type HostRouting = { router: WayRouter } | { router: null; unavailable: string };

type PlaybackStatus =
  | { kind: "none" }
  | { kind: "pricing" }
  | { kind: "failed"; error: string }
  | {
      kind: "ready";
      playback: Playback;
      stale: boolean;
      unavailable?: string;
    };

export interface PlaybackState {
  status: PlaybackStatus;
  playhead: number;
  playing: boolean;
  speed: Speed;
  reach: number;
}

export interface PlaybackSession {
  view: string | undefined;
  start: string | undefined;
}

interface Anchor {
  guide: string;
  step: number;
  fraction: number;
}

export class PlaybackStore {
  #state: PlaybackState = { status: { kind: "none" }, playhead: 0, playing: false, speed: 16, reach: 1 };
  readonly #listeners = new Set<() => void>();
  #attached: { input: PlaybackInput | null; routing: HostRouting } | undefined;
  #routing: { router: WayRouter | null; routing: PlaybackRouting } | undefined;
  #wanted: { source: number; step: number } | undefined;
  #openSource: number | undefined;
  #extended = 0;
  #session: PlaybackSession | undefined;
  #play: { input: PlaybackInput; routing: HostRouting; reach: number } | undefined;
  #queued = false;
  #followed: string | undefined;
  #moment: { playback: Playback; playhead: number; moment: PlaybackMoment | undefined } | undefined;
  #character: { playback: Playback; moment: PlaybackMoment } | undefined;
  #frame = 0;

  getState = (): PlaybackState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  moment = (): PlaybackMoment | undefined => {
    const { status, playhead } = this.#state;
    if (status.kind !== "ready") return undefined;
    const cached = this.#moment;
    if (cached?.playback === status.playback && cached.playhead === playhead) return cached.moment;
    const moment = status.playback.at(playhead);
    this.#moment = { playback: status.playback, playhead, moment };
    return moment;
  };

  character = (): SimState | undefined => {
    const { status } = this.#state;
    const moment = this.moment();
    if (!moment || status.kind !== "ready") return undefined;
    const last = this.#character;
    const same =
      last?.playback === status.playback &&
      last.moment.step === moment.step &&
      last.moment.activity === moment.activity &&
      last.moment.doing === moment.doing;
    if (!same) this.#character = { playback: status.playback, moment };
    return this.#character!.moment.character;
  };

  currentStep = (): number => {
    const { status, playhead } = this.#state;
    return status.kind === "ready" ? status.playback.stepAt(playhead) : -1;
  };

  attach(input: PlaybackInput | null, routing: HostRouting, session: PlaybackSession): () => void {
    const detach = () => {
      if (this.#attached?.input !== input || this.#attached.routing !== routing) return;
      this.#attached = undefined;
      queueMicrotask(() => {
        if (this.#attached) return;
        this.#stop();
        this.pause();
      });
    };
    if (input && (session.view !== this.#session?.view || session.start !== this.#session?.start)) {
      this.#session = session;
      this.#extended = 0;
      this.#schedule();
    }
    if (this.#attached?.input === input && this.#attached.routing === routing) return detach;
    this.#attached = { input, routing };
    if (this.#routing?.router !== routing.router) {
      this.#stop();
      const from = this.#routing?.routing;
      this.#routing = { router: routing.router, routing: new PlaybackRouting(routing.router, from && { from }) };
    }
    const { status } = this.#state;
    if (!input) {
      cancelAnimationFrame(this.#frame);
      this.#stop();
      this.#set({ status: { kind: "none" }, playhead: 0, playing: false });
      return detach;
    }
    if (status.kind === "ready") this.#set({ status: { ...status, stale: true } });
    else this.#set({ status: { kind: "pricing" } });
    this.#schedule();
    return detach;
  }

  extend(through: number): void {
    if (through <= this.#extended) return;
    this.#extended = through;
    this.#schedule();
  }

  #schedule() {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#sync();
    });
  }

  #sync() {
    const attached = this.#attached;
    const routing = this.#routing?.routing;
    if (!attached?.input || !routing) return;
    const { input } = attached;
    const reach = Math.max(1, this.#extended, this.#through(input));
    if (reach !== this.#state.reach) this.#set({ reach });
    const last = this.#play;
    if (last?.input === input && last.routing === attached.routing && last.reach === reach) return;
    const play = (this.#play = { input, routing: attached.routing, reach });
    const { status } = this.#state;
    if (status.kind === "ready" && !status.stale) this.#set({ status: { ...status, stale: true } });
    const unavailable = attached.routing.router ? undefined : attached.routing.unavailable;
    routing
      .play(
        input,
        reach,
        () => this.#state.playhead,
        (playback) => this.#show(playback, unavailable),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Playback", error);
        if (this.#play !== play) return;
        cancelAnimationFrame(this.#frame);
        this.#set({ status: { kind: "failed", error: error instanceof Error ? error.message : String(error) }, playing: false });
      });
  }

  #through(input: PlaybackInput): number {
    const open = this.#openSource;
    if (open === undefined) return 1;
    const { status } = this.#state;
    const shown = status.kind === "ready" ? status.playback.chain.find((g) => g.source === open) : undefined;
    return shown?.through ?? input.simulation.guides.findIndex((g) => g.source === open) + 1;
  }

  #stop() {
    this.#routing?.routing.stop();
    this.#play = undefined;
  }

  #show(playback: Playback, unavailable: string | undefined) {
    const { status, playhead } = this.#state;
    const old = status.kind === "ready" ? status.playback : undefined;
    const anchor = old && anchorOf(old, playhead);
    let next = Math.min(playhead, playback.timeline.totals.seconds);
    if (anchor) {
      const index = playback.timeline.steps.findIndex((s) => s.guide === anchor.guide && s.step === anchor.step);
      const step = playback.timeline.steps[index];
      if (step) next = step.start + anchor.fraction * step.seconds.total;
    }
    this.#set({ status: { kind: "ready", playback, stale: false, ...(unavailable && { unavailable }) }, playhead: next });
    if (this.#wanted) this.#seekWanted(this.#wanted);
    this.#schedule();
  }

  seek(seconds: number): void {
    const { status } = this.#state;
    const end = status.kind === "ready" ? status.playback.timeline.totals.seconds : 0;
    this.#set({ playhead: Math.max(0, Math.min(seconds, end)) });
  }

  seekStep(index: number): void {
    const { status } = this.#state;
    const step = status.kind === "ready" ? status.playback.timeline.steps[index] : undefined;
    if (step) this.seek(step.start);
  }

  follow(source: number, step: number | null): void {
    if (source !== this.#openSource) {
      this.#openSource = source;
      this.#schedule();
    }
    const key = `${source}:${step}`;
    if (key === this.#followed) return;
    this.#followed = key;
    this.#wanted = step === null ? undefined : { source, step };
    if (this.#wanted) this.#seekWanted(this.#wanted);
  }

  #seekWanted(wanted: { source: number; step: number }) {
    const { status } = this.#state;
    if (status.kind !== "ready") return;
    const index = status.playback.indexOf(wanted.source, wanted.step);
    if (index < 0) return;
    this.#wanted = undefined;
    this.seekStep(index);
  }

  play(): void {
    const { status, playhead, playing } = this.#state;
    if (playing || status.kind !== "ready") return;
    const end = status.playback.timeline.totals.seconds;
    this.#set({ playing: true, playhead: playhead >= end ? 0 : playhead });
    let last = performance.now();
    const tick = (now: number) => {
      const { status, playhead, playing, speed } = this.#state;
      if (!playing || status.kind !== "ready") return;
      const end = status.playback.timeline.totals.seconds;
      // A frame's timestamp is when the frame began, which can come before `last`.
      const next = Math.min(end, playhead + (Math.max(0, now - last) / 1000) * speed);
      last = Math.max(last, now);
      this.#set({ playhead: next, playing: next < end });
      if (next < end) this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  pause(): void {
    cancelAnimationFrame(this.#frame);
    if (this.#state.playing) this.#set({ playing: false });
  }

  setSpeed(speed: Speed): void {
    this.#set({ speed });
  }

  #set(change: Partial<PlaybackState>) {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

function anchorOf(playback: Playback, playhead: number): Anchor | undefined {
  const step = playback.timeline.steps[playback.stepAt(playhead)];
  if (!step) return undefined;
  const fraction = step.seconds.total > 0 ? Math.min(1, (playhead - step.start) / step.seconds.total) : 0;
  return { guide: step.guide, step: step.step, fraction };
}

export function usePlaybackStore(): PlaybackStore {
  return useStores().playback;
}

export function usePlayback<T>(select: (state: PlaybackState) => T): T {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function usePlayable(): Playback | undefined {
  return usePlayback((s) => (s.status.kind === "ready" && s.status.playback.timeline.steps.length > 0 ? s.status.playback : undefined));
}

export function useMoment(): PlaybackMoment | undefined {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.moment);
}

export function useCharacter(): SimState | undefined {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.character);
}

export const stepBefore = (steps: readonly { start: number }[], current: number) =>
  steps.findLastIndex((step) => step.start < (steps[current]?.start ?? -Infinity));

export function useCurrentStep(): number {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.currentStep);
}
