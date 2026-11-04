# Contributing

Thank you for your help with RXP Planner. The [docs index](docs/README.md)
lists the other docs.

## Ways to help

- **Report a bug.** Open an issue. Name the guide and the step, say what you
  expected, and say what the planner did. For a route or a time, give the map
  and the coordinates of the two points.
- **Fix a bug or add a feature.** For a large change, open an issue first
  to agree on the approach.
- **Update the built-in guides.** `pnpm import:rxp` imports a new release of
  RestedXP Guides. The header of `scripts/guides/import-rxp.ts` tells how.

Do not put purchased guides or RXP import strings in an issue, a pull
request, or a commit. They are for the personal use of one account.

## Set up

1. Follow [Building from source](README.md#building-from-source).
2. Install `unzip`. `pnpm test` needs it.

## Check a change

Before you open a pull request, run:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test path/to/changed.test.ts
```

Some changes need more checks:

- **Routing.** `pnpm test:routing` runs the whole-map routing checks on the
  installed release file. CI does not run them.
- **The dataset, the coordinates, or the built-in guides.**
  `pnpm test:release` runs the cases that need the whole release file.
- **The data contract package.** `pnpm contract:check` checks the package
  as a consumer installs it.
- **A change that users can see.** Try it with `pnpm dev`, and add a
  screenshot to the pull request.

CI runs `pnpm check` on the generic dataset and `pnpm test:release` on the
pinned release file. Run `pnpm check` locally only to reproduce a CI failure.

## Commits and pull requests

- Make one change per pull request, with a focused test for each change in
  behavior.
- Write the title as a
  [Conventional Commit](https://www.conventionalcommits.org/), such as
  `fix(playback): preserve the clock origin after an early frame`. Pull
  requests are squash-merged, so the title becomes the commit subject.
- In the description, say why the change exists and how you checked it.
- Comment only to explain why, when the code can't show it.
