import { useContext } from "react";
import { describeReason } from "../../rules/index.ts";
import { DatasetContext } from "../context.ts";
import { characterName } from "../preview/PreviewBar.tsx";
import { usePlaybackRoute, useSimData } from "../preview/route.ts";
import { usePreviewSettings } from "../preview/settings.ts";
import { usePlayback } from "./store.ts";

export interface PlaybackNotice {
  text: string;
  detail?: string;
  problem: boolean;
}

export function usePlaybackNotice(): PlaybackNotice | null {
  const dataset = useContext(DatasetContext);
  const settings = usePreviewSettings();
  const sim = useSimData(settings);
  const route = usePlaybackRoute();
  const status = usePlayback((s) => s.status);
  if (dataset?.error) return { text: "The game data did not load.", detail: dataset.error, problem: true };
  if (!route) return { text: "Open a guide to play its route.", problem: true };
  if (!sim || !route.simulation) return { text: "Loading game data…", problem: false };
  if (status.kind === "failed") return { text: "Playback could not price the route. Reload the page to try again.", problem: true };
  if (status.kind !== "ready") return { text: "Pricing the route…", problem: false };
  if (status.playback.timeline.steps.length > 0) return null;
  const start = route.preview.guides[0]!;
  const why = start.hidden && ` (${describeReason(start.hidden, route.profile)})`;
  return {
    text: `No steps of “${route.names[start.source]}” apply to ${characterName(settings)}${why || ""}. Change the character under Preview as.`,
    problem: true,
  };
}

export function PlaybackNoticeText({ notice }: { notice: PlaybackNotice }) {
  return (
    <p className={notice.problem ? "empty playback-notice problem" : "empty playback-notice"} role="status">
      {notice.text}
      {notice.detail && (
        <>
          {" "}
          <span className="playback-notice-detail">{notice.detail}</span>
        </>
      )}
    </p>
  );
}
