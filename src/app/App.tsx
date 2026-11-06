import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type RefObject,
  type ReactNode,
} from "react";
import { guideIconCatalog } from "../data/guideIcons.ts";
import {
  DatasetContext,
  EntityContext,
  EntityErrorContext,
  GameDataContext,
  GuideIconsContext,
  OpenImportContext,
  StoresContext,
  useEditor,
  useStores,
  type Stores,
} from "./context.ts";
import { Described } from "./Described.tsx";
import { EditorNotices } from "./EditorDock.tsx";
import { EditWorkspace } from "./EditWorkspace.tsx";
import { useOutsidePress } from "./effects.ts";
import { ExportDialog } from "./ExportDialog.tsx";
import { Icon } from "./icons.tsx";
import { Button, IconButton } from "./ui/Button.tsx";
import { MenuItem } from "./ui/MenuItem.tsx";
import { Segmented } from "./ui/Segmented.tsx";
import { ImportDialog } from "./ImportDialog.tsx";
import { ImportReader } from "./importReader.ts";
import { DOCK_INSET, useLayout, useLayoutStore, useTheme } from "./layout.ts";
import { LibraryDrawer } from "./Library.tsx";
import { Datalists } from "./LineFields.tsx";
import { NarrowNotice } from "./NarrowNotice.tsx";
import { PlaybackView } from "./playback/PlaybackView.tsx";
import { PreviewAs } from "./preview/PreviewBar.tsx";
import { RouteStrip } from "./preview/RouteStrip.tsx";
import { WarningsPanel } from "./preview/WarningsPanel.tsx";
import { Card } from "./ui/Card.tsx";

export function App({ stores }: { stores: Stores }) {
  const [importing, setImporting] = useState<ImportReader | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const startImport = useCallback(
    (files: readonly File[]) => {
      const reader = new ImportReader(stores.editor.getState().builtins);
      reader.add(files);
      setImporting(reader);
    },
    [stores],
  );
  const openImport = useCallback(() => startImport([]), [startImport]);

  const library = (
    <LibraryDrawer
      open={libraryOpen}
      onClose={() => {
        setLibraryOpen(false);
        libraryButton.current?.focus();
      }}
    />
  );
  return (
    <StoresContext.Provider value={stores}>
      <OpenImportContext.Provider value={openImport}>
        <ManifestData>
          <Shell
            className={dropping ? "dropping" : undefined}
            data-drawer={libraryOpen ? "library" : undefined}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={(e) => {
              if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDropping(false);
            }}
            onDrop={(e) => {
              setDropping(false);
              if (e.dataTransfer.files.length === 0) return;
              e.preventDefault();
              startImport([...e.dataTransfer.files]);
            }}
          >
            <NarrowNotice />
            <TopBar
              libraryOpen={libraryOpen}
              libraryButton={libraryButton}
              onLibrary={() => setLibraryOpen(!libraryOpen)}
              onImport={openImport}
              onExport={() => setExporting(true)}
            />
            <div className="region-character" data-region="character">
              <RouteStrip />
            </div>
            <ModeBody library={library}>
              <EditorNotices />
              <EditWorkspace libraryOpen={libraryOpen}>{library}</EditWorkspace>
            </ModeBody>
            <Datalists />
            {dropping && (
              <div className="drop-hint" aria-hidden="true">
                Drop to import guides
              </div>
            )}
          </Shell>
          {importing && <ImportDialog reader={importing} onClose={() => setImporting(null)} />}
          {exporting && <ExportDialog onClose={() => setExporting(false)} />}
        </ManifestData>
      </OpenImportContext.Provider>
    </StoresContext.Provider>
  );
}

const NO_ICONS = { catalog: guideIconCatalog(undefined), sheet: undefined };

function ManifestData({ children }: { children: ReactNode }) {
  const { dataset } = useStores();
  const state = useSyncExternalStore(dataset.subscribe, dataset.getState);
  const { data, error } = state;
  const icons = useMemo(() => data && { catalog: data.guideIcons, sheet: data.guideIconSheet }, [data]);
  return (
    <DatasetContext.Provider value={state}>
      <GameDataContext.Provider value={data?.game ?? null}>
        <EntityContext.Provider value={data?.entities ?? null}>
          <EntityErrorContext.Provider value={!!error}>
            <GuideIconsContext.Provider value={icons ?? NO_ICONS}>
              {error && (
                <div role="alert">
                  {error}{" "}
                  <Button variant="secondary" onClick={() => dataset.retry()}>
                    Retry dataset
                  </Button>
                </div>
              )}
              {children}
            </GuideIconsContext.Provider>
          </EntityErrorContext.Provider>
        </EntityContext.Provider>
      </GameDataContext.Provider>
    </DatasetContext.Provider>
  );
}

function Shell(props: ComponentProps<"div">) {
  const store = useLayoutStore();
  const layout = useLayout();
  return (
    <div
      {...props}
      id="app"
      className={`app${props.className ? ` ${props.className}` : ""}`}
      style={{
        "--steps-w": `${layout.stepsWidth}px`,
        "--dock-h": `${layout.dockHeight}px`,
        "--dock-inset": `${DOCK_INSET}px`,
        "--workspace-min-h": `${store.workspaceMinHeight()}px`,
      }}
    />
  );
}

function TopBar(props: {
  libraryOpen: boolean;
  libraryButton: RefObject<HTMLButtonElement | null>;
  onLibrary: () => void;
  onImport: () => void;
  onExport: () => void;
}) {
  const { guides } = useEditor();
  const { mode } = useLayout();
  const { autosave } = useStores();
  const saveStatus = useSyncExternalStore(autosave.subscribe, autosave.getState);
  return (
    <header className="topbar">
      <h1 className="brand">
        <Logo />
        <span className="wordmark" aria-hidden="true">
          <b>RXP</b> Planner
        </span>
        <span className="sr-only">RXP Planner</span>
      </h1>
      <ModeSwitch />
      <Described text="Your guides and RestedXP's built-in guides">
        <Button
          ref={props.libraryButton}
          variant="ghost"
          size={32}
          popoverOpen={props.libraryOpen}
          aria-controls="library-drawer"
          onClick={props.onLibrary}
        >
          <Icon name="library" />
          Library
        </Button>
      </Described>
      <span className="spacer" />
      {saveStatus === "error" && (
        <Described text="Edits stay in this window. The next edit retries.">
          <span className="save-failed" role="alert">
            <Icon name="warning" />
            Save failed
          </span>
        </Described>
      )}
      {mode === "edit" && <WarningsPanel />}
      <PreviewAs />
      <GuideFileActions canExport={guides.size > 0} onImport={props.onImport} onExport={props.onExport} />
      <ThemeToggle />
      <Ruler />
    </header>
  );
}

function Ruler() {
  return (
    <svg className="ruler" height="6" aria-hidden="true">
      <defs>
        <pattern id="banner-ruler" width="40" height="6" patternUnits="userSpaceOnUse">
          <path className="ruler-minor" d="M8.5 3v3M16.5 3v3M24.5 3v3M32.5 3v3" />
          <path className="ruler-major" d="M0.5 0v6" />
        </pattern>
      </defs>
      <rect width="100%" height="6" fill="url(#banner-ruler)" />
    </svg>
  );
}

function Logo() {
  return (
    <svg className="logo" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M2 9V2h7M23 2h7v7M30 23v7h-7M9 30H2v-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 25 C26 25.5 25 18.5 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M16 16 C7 13.5 6 7.5 22 7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 3"
      />
      <circle cx="8" cy="25" r="2.5" fill="currentColor" />
      <circle className="logo-paper-fill" cx="16" cy="16" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 4.5 L27 7.25 L22 10 Z" fill="currentColor" />
    </svg>
  );
}

function ModeSwitch() {
  const store = useLayoutStore();
  const { mode } = useLayout();
  return (
    <Segmented
      label="Mode"
      size={32}
      value={mode}
      onChange={(m) => store.update({ mode: m })}
      options={[
        { value: "edit", label: "Edit", icon: "pen" },
        { value: "playback", label: "Playback", icon: "play" },
      ]}
    />
  );
}

function GuideFileActions(props: { canExport: boolean; onImport: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const importItem = useRef<HTMLButtonElement>(null);
  const variantProps = props.canExport ? ({ variant: "primary" } as const) : ({ variant: "secondary" } as const);
  const close = () => {
    setOpen(false);
    arrow.current?.focus();
  };

  useOutsidePress(
    open,
    wrap,
    () => setOpen(false),
    () => importItem.current,
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Catches Escape and focus leaving from the buttons and menu inside.
    <span
      ref={wrap}
      className="split"
      role="group"
      aria-label="Guide file actions"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if (to && !e.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <Described text="Download guides as an addon for RestedXP Guides">
        <Button {...variantProps} size={32} className="split-main" onClick={props.onExport} disabled={!props.canExport}>
          <Icon name="export" />
          Export guide
        </Button>
      </Described>
      <IconButton
        ref={arrow}
        icon="chevronDown"
        label="More guide actions"
        {...variantProps}
        size={32}
        className="split-more"
        aria-haspopup="menu"
        aria-controls={menuId}
        popoverOpen={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
        }}
      />
      <Card layer id={menuId} className="split-menu" role="menu" aria-label="More guide actions" hidden={!open}>
        <Described text="Addon zip, Lua file, or guide text. You can also drop files.">
          <MenuItem
            ref={importItem}
            onClick={() => {
              close();
              props.onImport();
            }}
          >
            <Icon name="import" />
            Import guide
          </MenuItem>
        </Described>
      </Card>
    </span>
  );
}

function ModeBody({ library, children }: { library: ReactNode; children: ReactNode }) {
  return useLayout().mode === "playback" ? <PlaybackView>{library}</PlaybackView> : children;
}

function ThemeToggle() {
  const store = useLayoutStore();
  const dark = useTheme() === "dark";
  return (
    <IconButton
      icon={dark ? "sun" : "moon"}
      label={dark ? "Light mode" : "Dark mode"}
      description={`Switch to the ${dark ? "light" : "dark"} theme`}
      size={32}
      pressed={dark}
      iconShowsPressed
      onClick={() => store.update({ theme: dark ? "light" : "dark" })}
    />
  );
}
