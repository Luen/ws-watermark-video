import express from 'express'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import path from 'path'
import url from 'url'
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

const app = express()
app.set('trust proxy', 1) // trust first proxy

// Use necessary middleware
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(cookieParser())
app.use(csrf({ cookie: true }))
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
) // Implement security headers
app.use(compression())
app.use(
    cors({
        origin: function (origin, callback) {
            callback(null, true)
        },
        optionsSuccessStatus: 204,
        credentials: true, // Enable credentials (cookies, etc.)
    })
)
app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
    })
)

// Ensure directories exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
}
if (!fs.existsSync(tempFileDir)) {
    fs.mkdirSync(tempFileDir, { recursive: true })
}

app.get('/', (req, res) => {
    res.status(200)
        .contentType('text/plain')
        .send('Wanderstories Video Watermarker')
})

app.get('/favicon.ico', (req, res) => {
    res.sendFile('favicon.ico', { root: __dirname })
})

app.get('/content/images/videos/*', processVideoRequest)
app.get('/content/media/*', processVideoRequest)

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).send('Something went wrong!')
})

app.listen(port, () => {
    console.log(`Listening on port http://localhost:${port}`)
})

async function processVideoRequest(req, res, next) {
    const requestedPath = req.path

    // SSRF protection: Ensure requestedPath is strictly inside allowed directories and cannot contain evil tricks
    if (!isValidPath(requestedPath)) {
        return res.status(400).send('Invalid request')
    }

    const fileExtension = path.extname(requestedPath).slice(1).toLowerCase()
    const isAcceptedFormat = acceptedFormats.includes(fileExtension)
    if (!isAcceptedFormat) {
        // Block the request if it's not an accepted format
        return res.status(400).send('Invalid request')
    }

    const filename = sanitizeFilename(path.basename(requestedPath))
    const tempFilePath = path.join(tempFileDir, filename)
    const outputPath = path.join(outputDir, filename)

    try {
        if (fs.existsSync(outputPath)) {
            console.log(
                'File already exists, returning cached version:',
                filename
            )
            return res.sendFile(outputPath)
        }

        // SSRF protection: Use allowlist approach for hostname and strict path validation
        const allowedHostname = 'wanderstories.space'
        const originalVideoUrl = new URL(
            requestedPath,
            `https://${allowedHostname}`
        )

        // Additional SSRF protection: Verify the constructed URL is safe
        if (originalVideoUrl.hostname !== allowedHostname) {
            return res.status(400).send('Invalid request')
        }

        // Ensure the URL path is still valid after construction
        if (!isValidPath(originalVideoUrl.pathname)) {
            return res.status(400).send('Invalid request')
        }

        console.log('Processing video:', filename)

        const response = await fetch(originalVideoUrl.toString())
        if (!response.ok) {
            throw new Error(
                `Failed to fetch ${originalVideoUrl.toString()}: ${
                    response.statusText
                }`
            )
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        await fs.promises.writeFile(tempFilePath, buffer)

        await processVideo(tempFilePath, outputPath)

        res.sendFile(outputPath)
    } catch (err) {
        console.error('Error processing video request:', err)
        next(err)
    }
}

async function processVideo(inputPath, outputPath) {
    try {
        const video = await new ffmpeg(inputPath)
        await new Promise((resolve, reject) => {
            video.fnAddWatermark(
                logoPath,
                outputPath,
                { position: 'C' },
                (error) => {
                    if (error) return reject(error)
                    resolve()
                }
            )
        })
    } catch (error) {
        console.error('Error processing video:', error)
        throw error
    } finally {
        fs.unlink(inputPath, (err) => {
            if (err) console.error('Error deleting temp file:', err)
        })
    }
}

function isValidPath(requestedPath) {
    // Remove any possible path traversal, enforce leading slash
    if (!requestedPath.startsWith('/')) return false

    // Normalize the path to handle any potential path traversal attempts
    const normalizedPath = path.posix.normalize(requestedPath)

    // Accept only strict subpaths, not allowing ../ or path traversal
    const allowedPaths = ['/content/images/videos/', '/content/media/']
    if (!allowedPaths.some((basePath) => normalizedPath.startsWith(basePath))) {
        return false
    }

    // Only allow characters: alphanumerics, dash, underscore, slash, period
    if (!/^[\w\-\/\.]+$/.test(normalizedPath)) {
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
