# WS Watermark Video Proxy

[![Node.js](https://img.shields.io/badge/node-%3E%3D26.0.0-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm-1a73e8.svg)](https://pnpm.io/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![CI Build](https://github.com/Luen/ws-watermark-video/actions/workflows/node26-build.yml/badge.svg)](https://github.com/Luen/ws-watermark-video/actions/workflows/node26-build.yml)

A high-performance, secure proxy service built with **Express 5** and **FFmpeg** that dynamically fetches, watermarks, caches, and serves Wanderstories video content.

---

## Architecture & Request Lifecycle

```
Client Request
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ Express Middleware Pipeline                           │
│ • Helmet (CSP, CORP, COOP security headers)            │
│ • CORS (strictly whitelisted origins)                  │
│ • General Rate Limiter (skips health check)            │
│ • Video-Specific Rate Limiter                          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Path & Parameter Validation (isValidPath)              │
│ • Strict directory allowlist (/content/images/videos/  │
│   and /content/media/)                                 │
│ • Directory traversal & scheme injection prevention    │
│ • .mp4 extension enforcement                           │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
                  Is file cached in videos/?
                     /             \
             YES   /                 \  NO
                 /                     \
       ┌──────────────────┐    ┌──────────────────────────────────────────────┐
       │ Serve cached file│    │ Check In-Flight Deduplication (SingleFlight)  │
       │ from disk        │    │ • If in progress: await existing transcode   │
       └──────────────────┘    │ • If new: initiate transcode job             │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Stream Upstream Fetch        │
                                       │ • redirect: 'error' (Anti-   │
                                       │   SSRF)                      │
                                       │ • Timeout via AbortSignal    │
                                       │ • Max size limit enforcement │
                                       │ • Direct write to unique temp│
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ Transcode Semaphore Queue    │
                                       │ • Concurrency limiter (2 max)│
                                       │ • FFmpeg watermark injection │
                                       │ • Transcode to .tmp file     │
                                       │ • Atomic rename to videos/   │
                                       │ • Unconditional temp cleanup │
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                              Serve watermarked file
```

---

## Features

- **Dynamic Watermarking**: Applies `Wanderstories-logo.png` centered over MP4 video content using native FFmpeg.
- **Streaming Pipeline**: Streams downloads directly to disk with a transform stream size limiter (`MAX_VIDEO_SIZE_BYTES`), preventing V8 heap out-of-memory crashes on large files.
- **Concurrency Limiting**: Built-in asynchronous semaphore queue caps parallel FFmpeg processes (`MAX_CONCURRENT_TRANSCODES`) to protect host CPU and RAM.
- **SingleFlight Deduplication**: Coalesces concurrent in-flight requests for the same uncached video so redundant encoding work is never duplicated.
- **Collision-Free Atomic Caching**: Disk cache keys are hashed (`${sha256}-${filename}`) to prevent path collisions across subdirectories, and completed videos are moved via atomic rename (`fs.promises.rename`) to guarantee no corrupted or partial files enter the cache.
- **Multi-Layered Security**:
  - **SSRF Defense**: Strict subpath allowlisting, rejection of traversal (`..`), double-slash scheme bypasses, query strings, and `redirect: 'error'` on upstream fetch.
  - **CORS Protection**: Origin validation restricted to `wanderstories.space`, `*.wanderstories.space`, and development hosts, eliminating credentialed reflection vulnerabilities (CWE-942).
  - **Segmented Rate Limiting**: Global rate limiter skips health check routes (`/`, `/favicon.ico`) to eliminate container restart loops, coupled with a dedicated stricter rate limiter for heavy video transcoding routes.
  - **Hardened Cookies & CSRF**: HTTP-only, SameSite lax, and production-secure cookie flags with clean 403 error handling.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check and service status ping (`200 OK`). Unthrottled. |
| `GET` | `/favicon.ico` | Serves application favicon. |
| `GET` | `/content/images/videos/*splat` | Proxies and watermarks MP4 videos under the images path. |
| `GET` | `/content/media/*splat` | Proxies and watermarks MP4 videos under the media path. |

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Number | `8090` | Port the HTTP server listens on. |
| `ALLOWED_ORIGINS` | String | `""` | Additional comma-separated CORS origins (e.g. `https://example.com,https://app.example.com`). |
| `MAX_CONCURRENT_TRANSCODES` | Number | `2` | Maximum number of simultaneous FFmpeg transcoding processes. |
| `MAX_VIDEO_SIZE_BYTES` | Number | `524288000` (500 MB) | Maximum permitted size for incoming video files. |
| `MAX_CACHE_BYTES` | Number | `10737418240` (10 GB) | Maximum cache size in bytes before LRU eviction prunes oldest files (0 = disabled). |
| `CACHE_TTL_MS` | Number | `0` (disabled) | Cache time-to-live in milliseconds; files older than TTL are pruned on eviction. |
| `FETCH_TIMEOUT_MS` | Number | `30000` (30s) | Upstream fetch timeout in milliseconds. |
| `VIDEO_RATE_LIMIT_MAX` | Number | `30` | Maximum video transcode requests per 15-minute window per IP. |
| `TRUST_PROXY` | Boolean / Number | `1` (production) / `false` | Express `trust proxy` setting for reverse proxy deployments. |

---

## Prerequisites

- **Node.js**: `26.x` LTS or newer (see [`.nvmrc`](.nvmrc))
- **pnpm**: `10.x` or newer
- **FFmpeg & FFprobe**: Must be installed and accessible on system `PATH`

### Installing FFmpeg

- **Ubuntu / Debian**:
  ```bash
  sudo apt update && sudo apt install -y ffmpeg
  ```
- **macOS (Homebrew)**:
  ```bash
  brew install ffmpeg
  ```
- **Windows**:
  Download FFmpeg from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) or install via winget / scoop:
  ```powershell
  winget install Gyan.FFmpeg
  ```

---

## Quickstart

### Local Setup

```bash
# 1. Clone repository
git clone https://github.com/Luen/ws-watermark-video.git
cd ws-watermark-video/

# 2. Install dependencies
pnpm install

# 3. Start development server (nodemon hot reload)
pnpm run dev

# Or start production server
pnpm start
```

### Docker & Docker Compose

A production-ready, multi-arch Docker image running as a non-root user (`node`) is included:

```bash
# Build and run with Docker Compose
docker compose up --build

# Run in background
docker compose up -d

# View container logs
docker compose logs -f
```

The Docker container exposes port `8090` and mounts `./videos` and `./temp` for cached media persistence.

---

## Testing & Quality Assurance

This repository uses Node.js's native test runner (`node:test`) and ESLint 10 flat configuration:

```bash
# Run unit and integration test suite (20 tests)
pnpm test

# Run ESLint
pnpm run lint

# Run Snyk security audit
snyk test
```

---

## License

This project is licensed under the [ISC License](LICENSE).
