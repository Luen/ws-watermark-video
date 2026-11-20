# AGENTS.md

Agent-focused guidance for this repository ([AGENTS.md format](https://agents.md/)). Human-facing docs live in `README.md`.

## Living document

Treat this file as **living documentation**. Update it in the same PR when the stack, scripts, branch model, deploy path, or other project facts change. Future agents should keep it accurate rather than leaving stale instructions.

## Branch model

This repository uses **Trunk-Based Development** (single long-lived branch).

| Branch | Role |
| --- | --- |
| `main` | Default and production branch. All feature/fix PRs target `main`. |

- Open feature and fix PRs directly against **`main`**.
- Do not use `master` or `dev`.
- Merged branches are deleted automatically; `main` is the only long-lived branch.

## Package manager

This repo uses **pnpm** (`packageManager` in `package.json`).

- Install: `pnpm install` (do not use npm/yarn for installs in this repo).
- Scripts: `pnpm run <script>` / `pnpm exec <bin>`.
- Lockfile: `pnpm-lock.yaml` only — do not commit `package-lock.json` or `yarn.lock`.
- Local disk: pnpm's content-addressable store shares package contents across checkouts on the same machine.

## Dependency and deploy notes

### Tier B - Docker services (nightly on main)

- Nightly GitHub Action (`.github/workflows/nightly-minor-deps-release.yml`) runs on **`main`**:
  1. npm-check-updates `--target semver` with `--cooldown 3` (raises package.json in-major ranges; lockfile re-resolved after)
  2. lint/test when scripts exist
  3. if package.json ranges changed: lint/test; **release only when a production dependency moved** (`dependencies` / `optionalDependencies` / `peerDependencies`) — patch bump, commit, GitHub Release, image. `devDependencies`-only updates commit without releasing
- Images are published to GHCR as `ghcr.io/<owner>/<repo>:latest`, `:v<version>`, and `:<sha>`.
- Servers should pull/recreate from GHCR (e.g. Watchtower or cron).
- Publishing a GitHub Release triggers `.github/workflows/release-publish.yml`, which builds and pushes the multi-arch image for that tag.
- Dependabot auto-merge for routine minor/patch is **disabled** here to avoid duplicate bumps; leave majors/security as human-reviewed PRs.
- No extra registry secrets are needed: the workflows authenticate to GHCR with the built-in `GITHUB_TOKEN` (`packages: write`).

## Project overview

Wanderstories video watermark proxy: Express + ffmpeg. Videos are fetched from `wanderstories.space`, watermarked, and cached on disk. Cache growth is bounded by `MAX_CACHE_BYTES` (LRU eviction) and optionally `CACHE_TTL_MS`; temp files are cleaned at startup and on graceful shutdown.

## Setup

Requires Node.js 26+, plus `ffmpeg` and `ffprobe` on PATH (`ffmpeg.exe` next to the repo on Windows, or `apt`/`brew` install).

```bash
pnpm install
pnpm start
pnpm run dev
pnpm run lint
pnpm test
```

## Conventions

- Run `pnpm run lint` and `pnpm test` after JS changes; fix issues before finishing.
- Sanitize filenames and user input; keep Helmet / CSRF / rate-limit behavior intact.
- Never commit secrets or uploaded media.


## Pull requests

Before merging any pull request:

1. **Read all comments** on the PR — conversation comments, review comments (including those on specific lines), and bot comments. Address or acknowledge them. Do not merge while review feedback is unresolved.
2. **Wait for CI to complete successfully.** GitHub Actions (and other required checks) on the PR must finish and pass. Do not merge while checks are pending, failed, cancelled, or skipped when they are required. If CI fails, fix the cause and wait for a green run before merging.

## Node runtime

Use Node.js 26 LTS (`.nvmrc`). Docker pins Node 26.13.1 with its multi-platform image digest. Install pnpm via `npm install -g pnpm@<pinned-version>` in Node 26 images; Corepack is no longer bundled. PR checks build the production Docker image without publishing it.
