# StreamSite

[![make.fun · Build a static site faster](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![Rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Czj027/streamsite-makefun/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard)
[![Reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Czj027/streamsite-makefun/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

StreamSite is a dependency-free Node.js 22 implementation of the `makefun-site` dialect for the make.fun static site speed bounty. It renders a site's Markdown and templates into a path-to-text map, including pagination, tags, static files, and a deterministic build report.

Markdown is scanned and rendered in one pass. Each template is parsed once per site, and post cards and slugs are reused within that site. Each call to `run(input)` creates its own build state.

## Run

Use Node.js 22.18 or later. From a terminal with the official kit unpacked, run the practice scorer against this directory.

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/streamsite-makefun --driver process --worktree
node cli/makefun.mjs check --kit . --repo /path/to/streamsite-makefun --worktree
```

`node main.ts` reads `cases.json` from `/input` and writes `answers.json` to `/output`. For a local run, set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to existing directories. The input is a JSON array of `{id, input}` records, and the output is the array of site trees in the same order.

The [official kit](https://make.fun/c/site-generator-speed-01-run-20261122/kit) provides the practice inputs and reference implementation. The entry runs entirely offline with the Node.js standard library.
