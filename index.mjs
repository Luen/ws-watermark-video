import express from 'express'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import path from 'path'
import url from 'url'
import crypto from 'crypto'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import ffmpeg from 'ffmpeg'
import helmet from 'helmet'
import compression from 'compression'
import cors from 'cors'
import csrf from '@dr.pogodin/csurf'
import cookieParser from 'cookie-parser'
import sanitizeFilename from 'sanitize-filename'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const port = process.env.PORT || 8090

const logoPath = path.resolve(process.cwd(), 'Wanderstories-logo.png')
const acceptedFormats = ['mp4']
const tempFileDir = path.resolve(process.cwd(), 'temp')
const outputDir = path.resolve(process.cwd(), 'videos')

const MAX_VIDEO_SIZE_BYTES = parseInt(
    process.env.MAX_VIDEO_SIZE_BYTES || `${500 * 1024 * 1024}`, // 500 MB default
    10
)
const FETCH_TIMEOUT_MS = parseInt(
    process.env.FETCH_TIMEOUT_MS || '30000', // 30s default
    10
)
const MAX_CONCURRENT_TRANSCODES = parseInt(
    process.env.MAX_CONCURRENT_TRANSCODES || '2',
    10
)

const app = express()

// Trust proxy configuration
const trustProxyConfig =
    process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : false)
if (trustProxyConfig !== false && trustProxyConfig !== 'false') {
    app.set('trust proxy', trustProxyConfig === 'true' ? true : trustProxyConfig)
}

// Ensure directories exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
}
if (!fs.existsSync(tempFileDir)) {
    fs.mkdirSync(tempFileDir, { recursive: true })
}
if (!fs.existsSync(logoPath)) {
    console.warn(`Warning: Watermark logo not found at ${logoPath}`)
}

// CORS origin validation
const defaultAllowedOrigins = [
    'https://wanderstories.space',
    'https://images.wanderstories.space',
]
const envAllowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : []
const allowedOrigins = [...defaultAllowedOrigins, ...envAllowedOrigins]

function isOriginAllowed(origin) {
    if (!origin) return true // Allow same-origin / server-to-server / curl
    if (allowedOrigins.includes(origin)) return true
    try {
        const parsed = new URL(origin)
        if (
            parsed.protocol === 'https:' &&
            (parsed.hostname === 'wanderstories.space' ||
                parsed.hostname.endsWith('.wanderstories.space'))
        ) {
            return true
        }
        if (
            process.env.NODE_ENV !== 'production' &&
            (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        ) {
            return true
        }
    } catch {
        return false
    }
    return false
}

// Use necessary middleware
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(cookieParser())
app.use(
    csrf({
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        },
    })
)
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    'https://static.cloudflareinsights.com',
                    'https://www.googletagmanager.com',
                    'https://www.google-analytics.com',
                ],
                connectSrc: [
                    "'self'",
                    'https://images.wanderstories.space',
                    'https://static.cloudflareinsights.com',
                    'https://www.google.com.au',
                    'https://www.google-analytics.com',
                ],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https://wanderstories.space'],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                frameAncestors: ["'self'"],
                upgradeInsecureRequests: [],
            },
        },
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
)
app.use(compression())
app.use(
    cors({
        origin: function (origin, callback) {
            if (isOriginAllowed(origin)) {
                callback(null, true)
            } else {
                callback(new Error('Not allowed by CORS'))
            }
        },
        optionsSuccessStatus: 204,
        credentials: true,
    })
)

// General rate limiter for all routes, skipping healthcheck/favicon
const generalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/' || req.path === '/favicon.ico',
})
app.use(generalRateLimiter)

// Dedicated, stricter rate limiter for video transcoding endpoints
const videoRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.VIDEO_RATE_LIMIT_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many video processing requests, please try again later.',
})

// Simple semaphore for concurrency control on ffmpeg transcoding
class Semaphore {
    constructor(max) {
        this.max = max
        this.current = 0
        this.queue = []
    }

    async acquire() {
        if (this.current < this.max) {
            this.current++
            return () => this.release()
        }
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.current++
                resolve(() => this.release())
            })
        })
    }

    release() {
        this.current--
        if (this.queue.length > 0 && this.current < this.max) {
            const next = this.queue.shift()
            next()
        }
    }
}
const transcodeSemaphore = new Semaphore(MAX_CONCURRENT_TRANSCODES)

// In-flight deduplication to prevent duplicate concurrent transcoding jobs
const inFlightTranscodes = new Map()

app.get('/', (req, res) => {
    res.status(200)
        .contentType('text/plain')
        .send('Wanderstories Video Watermarker')
})

app.get('/favicon.ico', (req, res) => {
    res.sendFile('favicon.ico', { root: __dirname })
})

// Express 5 requires named wildcards (path-to-regexp v8); bare /* is invalid.
app.get('/content/images/videos/*splat', videoRateLimiter, processVideoRequest)
app.get('/content/media/*splat', videoRateLimiter, processVideoRequest)

app.use((err, req, res, _next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).send('Invalid CSRF token')
    }
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).send('Not allowed by CORS')
    }
    console.error(err.stack)
    res.status(500).send('Something went wrong!')
})

const isMainModule =
    process.argv[1] &&
    import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href

if (isMainModule) {
    app.listen(port, () => {
        console.log(`Listening on port http://localhost:${port}`)
    })
}

async function processVideoRequest(req, res, next) {
    const requestedPath = req.path

    // SSRF protection: Ensure requestedPath is strictly inside allowed directories and cannot contain evil tricks
    if (!isValidPath(requestedPath)) {
        return res.status(400).send('Invalid request')
    }

    const normalizedPath = path.posix.normalize(requestedPath)

    const fileExtension = path.extname(normalizedPath).slice(1).toLowerCase()
    const isAcceptedFormat = acceptedFormats.includes(fileExtension)
    if (!isAcceptedFormat) {
        return res.status(400).send('Invalid request')
    }

    const rawBasename = path.basename(normalizedPath)
    const filename = sanitizeFilename(rawBasename)
    if (!filename) {
        return res.status(400).send('Invalid request')
    }

    // Hash normalized path to prevent collision between identical filenames in different subpaths
    const pathHash = crypto.createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16)
    const cachedFilename = `${pathHash}-${filename}`
    const outputPath = path.join(outputDir, cachedFilename)

    try {
        if (fs.existsSync(outputPath)) {
            console.log('File already exists, returning cached version:', filename)
            return res.sendFile(cachedFilename, { root: outputDir })
        }

        // If another request is currently transcoding this exact video, await its result
        if (inFlightTranscodes.has(normalizedPath)) {
            console.log('Video request already in flight, awaiting result:', filename)
            await inFlightTranscodes.get(normalizedPath)
            return res.sendFile(cachedFilename, { root: outputDir })
        }

        const transcodePromise = (async () => {
            const allowedHostname = 'wanderstories.space'

            // Construct and verify URL
            const originalVideoUrl = new URL(
                normalizedPath,
                `https://${allowedHostname}`
            )

            if (originalVideoUrl.hostname !== allowedHostname) {
                throw new Error('INVALID_HOSTNAME')
            }

            const safeUrl = `https://${allowedHostname}${normalizedPath}`
            if (originalVideoUrl.toString() !== safeUrl) {
                throw new Error('INVALID_URL')
            }

            console.log('Fetching video:', filename)

            const response = await fetch(safeUrl, {
                redirect: 'error',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            })

            if (response.status === 404) {
                const notFoundErr = new Error('NOT_FOUND')
                notFoundErr.status = 404
                throw notFoundErr
            }
            if (!response.ok) {
                const upstreamErr = new Error('UPSTREAM_ERROR')
                upstreamErr.status = 502
                throw upstreamErr
            }

            const contentLength = response.headers.get('content-length')
            if (contentLength && parseInt(contentLength, 10) > MAX_VIDEO_SIZE_BYTES) {
                const tooLargeErr = new Error('FILE_TOO_LARGE')
                tooLargeErr.status = 413
                throw tooLargeErr
            }

            const uniqueId = crypto.randomUUID()
            const tempFilePath = path.join(tempFileDir, `${uniqueId}-${filename}`)
            const tempOutputPath = path.join(tempFileDir, `${uniqueId}-out-${filename}`)

            try {
                // Stream download directly to disk while counting bytes
                let bytesDownloaded = 0
                const sizeLimiter = new Transform({
                    transform(chunk, _encoding, callback) {
                        bytesDownloaded += chunk.length
                        if (bytesDownloaded > MAX_VIDEO_SIZE_BYTES) {
                            const err = new Error('FILE_TOO_LARGE')
                            err.status = 413
                            callback(err)
                            return
                        }
                        callback(null, chunk)
                    },
                })

                const writeStream = fs.createWriteStream(tempFilePath)
                await pipeline(
                    Readable.fromWeb(response.body),
                    sizeLimiter,
                    writeStream
                )

                // Acquire semaphore slot for transcoding
                const releaseSlot = await transcodeSemaphore.acquire()
                try {
                    console.log('Processing video with ffmpeg:', filename)
                    await processVideo(tempFilePath, tempOutputPath)

                    await fs.promises.rename(tempOutputPath, outputPath)
                } finally {
                    releaseSlot()
                }

                return cachedFilename
            } finally {
                fs.unlink(tempFilePath, (_err) => {})
                fs.unlink(tempOutputPath, (_err) => {})
            }
        })()

        inFlightTranscodes.set(normalizedPath, transcodePromise)

        try {
            await transcodePromise
            res.sendFile(cachedFilename, { root: outputDir })
        } finally {
            inFlightTranscodes.delete(normalizedPath)
        }
    } catch (err) {
        if (err.status === 404) {
            return res.status(404).contentType('text/plain').send('Video not found')
        }
        if (err.status === 413) {
            return res.status(413).contentType('text/plain').send('Video file exceeds maximum allowed size')
        }
        if (err.status === 502) {
            return res.status(502).contentType('text/plain').send('Upstream server error')
        }
        if (err.name === 'TimeoutError') {
            return res.status(504).contentType('text/plain').send('Upstream request timed out')
        }
        console.error('Error processing video request:', err)
        next(err)
    }
}

async function processVideo(inputPath, outputPath) {
    try {
        const video = await ffmpeg(inputPath)
        await video.fnAddWatermark(logoPath, outputPath, { position: 'C' })
    } catch (error) {
        console.error('Error in ffmpeg processing:', error)
        throw error
    }
}

function isValidPath(requestedPath) {
    // Remove any possible path traversal, enforce leading slash
    if (!requestedPath || !requestedPath.startsWith('/') || requestedPath.startsWith('//')) {
        return false
    }

    // Normalize the path to handle any potential path traversal attempts
    const normalizedPath = path.posix.normalize(requestedPath)

    // Accept only strict subpaths, not allowing ../ or path traversal
    const allowedPaths = ['/content/images/videos/', '/content/media/']
    if (!allowedPaths.some((basePath) => normalizedPath.startsWith(basePath))) {
        return false
    }

    // Only allow characters: alphanumerics, dash, underscore, slash, period
    if (!/^[\w\-/.]+$/.test(normalizedPath)) {
        return false
    }

    // Never allow `..` anywhere, which could indicate traversal trickery
    if (normalizedPath.includes('..')) {
        return false
    }

    // Additional SSRF protection: Check for potential URL scheme manipulation
    // Prevent any attempt to include protocol, hostname, or port in the path
    if (normalizedPath.includes('://') || normalizedPath.includes(':')) {
        return false
    }

    // Prevent any attempt to include query parameters or fragments
    if (normalizedPath.includes('?') || normalizedPath.includes('#')) {
        return false
    }

    // Ensure the path doesn't end with a trailing slash (except for the base paths)
    if (
        normalizedPath !== '/content/images/videos/' &&
        normalizedPath !== '/content/media/' &&
        normalizedPath.endsWith('/')
    ) {
        return false
    }

    return true
}

export { app, isValidPath, isOriginAllowed, processVideoRequest }
