# RXP Planner

RXP Planner builds RestedXP guides for World of Warcraft: Forever. Use pnpm.
Before you work in an area, read its doc in the [docs index](docs/README.md).

## How we work

Lint holds only part of these rules. It holds the import order between the
modules, and it keeps browser storage in `src/storage` and
`src/app/savedSetting.ts`. For the rest, use your judgment.

- **Preserve guide text.** An unedited line keeps its exact text through
  import, editing, saving, and export, including unknown syntax, comments,
  and the final newline. Line endings are the exception. A guide uses CRLF
  if its text has any CRLF, and LF otherwise. Addon export always writes LF,
  because Lua reads long strings that way. Edit through the `src/guide`
  helpers, which clear `raw` only on changed lines.
- **Match RXP's behavior.** Parsing, conditions, coordinates, and route
  preview behave like the RestedXP addon at the bundled guides' version.
  Write the planner's own implementation, copy no addon code, and add a
  focused test for each behavior.
- **Keep the logic in the core.** The UI calls `guide`, `rules`, `io`,
  `data`, and `routing` instead of repeating their logic. Node runs the
  scripts and can't load `.tsx`, so keep code that a script imports in `.ts`
  files.
- **Keep saved work.** A storage change keeps saved guides, settings, and
  unsaved-change recovery. A schema change bumps the IndexedDB version in
  `src/storage/db.ts` and migrates in `onupgradeneeded`. Editing a built-in
  guide makes a custom copy. The IndexedDB name and the localStorage keys
  keep the prefix `restedxp-planner`, the planner's former name, because
  renaming them loses what browsers already saved.
- **Use the pinned release file.** `scripts/dataset/pin.json` pins the
  release file by SHA-256. [Install the release file](README.md#install-the-release-file)
  has the commands. To change or roll back the release, change the pin and
  install again. Source inputs, normalization, and acquisition belong in the
  data producer, not here.
- **Write for one reader.** `README.md` is for users, `CONTRIBUTING.md` for
  contributors, and this page for agents. A doc, like a comment, gives a
  reason that the code can't show. Incidents go in the pull request,
  not in a doc.

## Comments

Write no comment by default. If a comment would say what code does or why it
exists, change a name or the shape of the code instead. Write a comment only
for a reason the code can't show:

- a contract the type can't show, such as a unit, an order, or what
  `undefined` means
- a rule from outside the code, such as RXP, a browser, or the dataset
  release
- where a tuned number comes from
- why code looks wrong but is right, such as an order of listeners or a
  second subscription

Leave out what the code or a name already says, history such as old behavior
or issue numbers (that goes in the pull request), and details that go stale,
such as line numbers, counts, or versions.

- When you change a function, reread its doc comment and fix what no longer
  holds.
- In a test, the `it` title names the case. A comment only says why the
  expected value is right.
- Cite RXP by file and symbol, such as `addon.ParseGuide` in
  `GuideLoader.lua`, with no version.
- A reason about one file goes in that file. A reason that spans files goes
  in a `docs/` page.
- Before you suppress a lint rule, change the code to follow the rule.
  Suppress it only when the rule is wrong for that line, and give the reason
  on the same line. "Debt" is not a reason. Fix the code.

## Code layout

- `src/guide/` parses guide text and Lua `RegisterGuide` calls into a
  document model, edits it, and writes it back.
- `src/rules/` holds RXP's rules for a character: conditions, tags, route
  preview, route checks, and the leveling simulation and its timeline.
- `src/io/` imports guides from addon zips, Lua, and plain text, and exports
  the addon.
- `src/data/` loads and checks the dataset, and holds quest data, zone maps,
  and coordinates.
- `src/routing/` finds ground routes on the pinned routing artifact, joins
  them with transports into journeys, and routes Playback.
- `src/agent/` holds the agent tools, and `scripts/agent/mcp.ts` serves them
  over MCP.
- `src/app/` holds the React UI.
- `packages/data-contract/` holds the contract for the finished dataset.
- `guides/rxp-forever/` holds the upstream guides that the built-in guides
  come from. The header of `scripts/guides/import-rxp.ts` tells how to
  update them.

## Verification

- In a fresh worktree, run `pnpm install --reporter=append-only` first.
- Before you hand off, run `pnpm format`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm test <file>` for the changed behavior.
- CI runs `pnpm check` and `pnpm test:release` on every pull request. Run
  `pnpm check` locally only to reproduce a CI failure.
- To measure a performance change, run the area's `pnpm bench:*` through
  `pnpm bench:ab` against a worktree of the pull request's base. See
  [Measure performance](CONTRIBUTING.md#measure-performance).

### Focused tests for each area

Also run the row for each area that the change touches.

| Area                      | What to run                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guide format              | `pnpm test src/guide/bundled.test.ts src/io/roundtrip.test.ts`                                                                                                             |
| Built-in guides           | The guide format row, and `pnpm test:release`                                                                                                                              |
| Coordinates               | `pnpm test src/data/geometryContract.test.ts src/data/maps.test.ts src/data/gameData.test.ts src/rules/points.test.ts src/app/map/points.test.ts`, and `pnpm test:release` |
| Terrain or tile placement | The coordinates row, and `pnpm test src/data/dataset.test.ts src/app/map/terrain.test.ts src/app/map/MapPanel.test.tsx`                                                    |
| Routing                   | `pnpm test src/routing`, and `pnpm test:routing` for the whole-map checks on the installed release file                                                                    |
| Data contract             | `pnpm test src/data/manifestContract.test.ts src/data/geometryContract.test.ts`                                                                                            |
| Data contract package     | The data contract row, and `pnpm contract:check`                                                                                                                           |
| The dataset or its pin    | `pnpm test:release`                                                                                                                                                        |

A case that needs the whole release, such as every quest of a guide or every
coordinate, goes in a `*.release.test.ts` or `*.release.test.tsx` file. It
takes its expected values from the pinned release through
`src/data/releaseInputs.ts`. Other cases use small hand-picked fixtures,
such as the files in `src/data/`, `data/fixtures/`, and
`src/routing/fixtures/`. `pnpm test` skips the release cases.
