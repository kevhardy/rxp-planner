import { useLayoutEffect, useRef, type ReactNode } from "react";
import { EditorDock } from "./EditorDock.tsx";
import { Gutter } from "./Gutter.tsx";
import { useEditorPanel, useLayoutStore } from "./layout.ts";
import { MapColumn } from "./map/MapPanel.tsx";
import { StepList } from "./StepList.tsx";

function headerHeight(root: HTMLElement, pane: string): number {
  const panel = root.querySelector<HTMLElement>(pane);
  const head = panel?.querySelector<HTMLElement>(":scope > .panel-head");
  return panel && head ? head.offsetHeight + panel.offsetHeight - panel.clientHeight : 0;
}

export function EditWorkspace({ children, libraryOpen }: { children: ReactNode; libraryOpen: boolean }) {
  const store = useLayoutStore();
  const panel = useEditorPanel();
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = body.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (root.clientHeight === 0) return;
      const routes = root.querySelector(".route-workspace");
      const toolbar = routes?.querySelector(".route-bar");
      const footer = routes?.querySelector(".route-map > .route-strip");
      const floatingStrip = !!footer && getComputedStyle(footer).position !== "static";
      const routeHeight =
        (toolbar?.getBoundingClientRect().height ?? 0) + (footer && !floatingStrip ? footer.getBoundingClientRect().height : 0);
      store.setEditSpace({
        height: root.clientHeight,
        mapChrome: headerHeight(root, ".map-panel") + Math.ceil(routeHeight),
        dockHeader: headerHeight(root, ".editor-dock"),
        floatingStrip,
      });
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!root.querySelector(".route-workspace")) {
        measure();
        return;
      }
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    const watch = () => {
      observer.disconnect();
      mounts.disconnect();
      observer.observe(root);
      for (const element of root.querySelectorAll(
        ".map-panel > .panel-head, .editor-dock > .panel-head, .map-body, .route-bar, .route-map > .route-strip",
      ))
        observer.observe(element);
      const mapBody = root.querySelector(".map-panel > .map-body");
      if (mapBody) mounts.observe(mapBody, { childList: true });
      const routes = root.querySelector(".route-workspace");
      if (routes) mounts.observe(routes, { childList: true });
      measure();
    };
    const mounts = new MutationObserver(watch);
    watch();
    return () => {
      observer.disconnect();
      mounts.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [store, panel]);

  return (
    <div ref={body} className="body">
      {children}
      <StepList libraryOpen={libraryOpen} />
      <Gutter size="stepsWidth" label="Resize steps" orientation="vertical" className="gutter-steps" />
      <div className="editor-workspace" data-editor={panel}>
        <MapColumn />
        {panel === "open" && (
          <>
            <Gutter size="dockHeight" label="Resize editor" orientation="horizontal" direction={-1} className="gutter-dock" />
            <EditorDock />
          </>
        )}
      </div>
    </div>
  );
}
