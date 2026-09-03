# AGENTS.md

Agent-focused guidance for this repository ([AGENTS.md format](https://agents.md/)). Human-facing docs live in `README.md`.

## Living document

Treat this file as **living documentation**. Update it in the same PR when the stack, scripts, branch model, deploy path, or other project facts change. Future agents should keep it accurate rather than leaving stale instructions.

## Branch model

| Branch | Role |
| --- | --- |
| `dev` | Default branch for features and improvements |
| `main` | Production. Safe dependency bumps and releases land here |

- Open feature/fix PRs against **`dev`**.
- Promote to **`main`** when ready for production.
- Do not use `master` (rename to `main` if any remnant remains).

## Dependency and deploy notes

### Tier B - Docker services (nightly on main)

- Nightly GitHub Action (`.github/workflows/nightly-minor-deps-release.yml`) runs on **`main`**:
  1. `npm update` (in-range / minor+patch only)
  2. lint/test when scripts exist
  3. if lockfile changed: patch bump, commit to `main`, GitHub Release, push Docker Hub image
- Image tags: `$DOCKERHUB_USERNAME/<repo>:latest`, `:v<version>`, `:<sha>`
- Servers should pull/recreate from Docker Hub (e.g. Watchtower or cron).
- Dependabot auto-merge for routine minor/patch is **disabled** here to avoid duplicate bumps; leave majors/security as human-reviewed PRs.
- Requires repo secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Existing guidance
Agent-focused guidance for this repository ([AGENTS.md format](https://agents.md/)). Human-facing docs live in `README.md`.

Treat this file as living documentation: update it when the stack, scripts, or project facts change.

## Project overview

Wanderstories video watermark proxy: Express + ffmpeg.

## Setup

Requires Node.js 24+, plus `ffmpeg` and `ffprobe` on PATH (`ffmpeg.exe` next to the repo on Windows, or `apt`/`brew` install).

```bash
npm install
npm start
npm run dev
npm run lint
```

## Conventions

- Run `npm run lint` after JS changes; fix issues before finishing.
- Sanitize filenames and user input; keep Helmet / CSRF / rate-limit behavior intact.
- Never commit secrets or uploaded media.


## Pull requests

Before merging any pull request:

1. **Read all comments** on the PR â€” conversation comments, review comments (including those on specific lines), and bot comments. Address or acknowledge them. Do not merge while review feedback is unresolved.
2. **Wait for CI to complete successfully.** GitHub Actions (and other required checks) on the PR must finish and pass. Do not merge while checks are pending, failed, cancelled, or skipped when they are required. If CI fails, fix the cause and wait for a green run before merging.
