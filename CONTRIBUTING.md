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

## Measure performance

The benchmarks run on the installed release file. Each one writes JSON
Lines to stdout. The header of each script lists its scenarios and options.

```sh
timeout 1800s pnpm bench:routing --runs 5
timeout 1800s pnpm bench:playback --runs 5
pnpm bench:routing --case boat --runs 5 > boat.jsonl
```

To show that a change makes code faster or slower, compare the change with
its base. Measure both on the same machine at the same time.

1. Make a worktree of the base, and install it:

   ```sh
   git worktree add --detach ../rxp-base origin/main
   pnpm --dir ../rxp-base install
   ```

2. From your checkout, run the benchmark on both sides:

   ```sh
   pnpm bench:ab --base ../rxp-base --head . --runs 5 --out /tmp/ab -- bench:playback --case northshire-1 --runs 1
   ```

   `bench:ab` runs each side once and discards the result. Then it runs
   base and head in turn, saves each run in `--out`, and prints a table.
   A run that fails stops the comparison. Give the benchmark `--runs 1`, so
   that each sample comes from a separate process, in turn with the other side.

3. Remove the worktree with `git worktree remove ../rxp-base`.

To compare saved runs again, use
`pnpm bench:compare --base FILE... --head FILE...`. With `--fail-on-slower`,
it exits nonzero when a row is `slower`.

Every metric is lower-is-better. Each row of the table gives a verdict:

- **`faster`.** Every head sample is below every base sample.
- **`slower`.** Every head sample is above every base sample.
- **`no measurable difference`.** The two ranges overlap. The change in the
  medians is then noise, even when it is large.

A row can also have a note:

- **`output changed`.** The head computes another result, so the times do
  not measure the same work.
- **`fewer than 5 samples`.** Add runs before you trust the verdict.

`bench:compare` refuses to compare runs of different benchmarks or on
different datasets.

## Commits and pull requests

- Make one change per pull request, with a focused test for each change in
  behavior.
- Write the title as a
  [Conventional Commit](https://www.conventionalcommits.org/), such as
  `fix(playback): preserve the clock origin after an early frame`. Pull
  requests are squash-merged, so the title becomes the commit subject.
- In the description, say why the change exists and how you checked it.
- Comment only to explain why, when the code can't show it.
