import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app, isValidPath, isOriginAllowed, cleanTempDir, evictCacheIfNeeded } from '../index.mjs'

test('isValidPath path validation', async (t) => {
    await t.test('accepts valid paths under /content/images/videos/', () => {
        assert.equal(isValidPath('/content/images/videos/test.mp4'), true)
        assert.equal(isValidPath('/content/images/videos/2023/walk.mp4'), true)
        assert.equal(isValidPath('/content/images/videos/a-b_c.123.mp4'), true)
    })

    await t.test('accepts valid paths under /content/media/', () => {
        assert.equal(isValidPath('/content/media/teaser.mp4'), true)
        assert.equal(isValidPath('/content/media/sub/folder/sample.mp4'), true)
    })

    await t.test('rejects paths outside allowed directories', () => {
        assert.equal(isValidPath('/etc/passwd'), false)
        assert.equal(isValidPath('/content/images/other.mp4'), false)
        assert.equal(isValidPath('/content/media'), false) // must be within subpath with leading slash
    })

    await t.test('rejects traversal attempts and double slashes', () => {
        assert.equal(isValidPath('/content/images/videos/../secret.mp4'), false)
        assert.equal(isValidPath('/content/images/videos/..'), false)
        assert.equal(isValidPath('//content/images/videos/test.mp4'), false)
    })

    await t.test('rejects schemes, query parameters, fragments and invalid chars', () => {
        assert.equal(isValidPath('/content/images/videos/test.mp4?foo=bar'), false)
        assert.equal(isValidPath('/content/images/videos/test.mp4#hash'), false)
        assert.equal(isValidPath('/content/images/videos/http://evil.com/a.mp4'), false)
        assert.equal(isValidPath('/content/images/videos/space name.mp4'), false)
    })
})

test('isOriginAllowed CORS validation', async (t) => {
    await t.test('allows same-origin / non-browser requests without origin', () => {
        assert.equal(isOriginAllowed(undefined), true)
        assert.equal(isOriginAllowed(''), true)
    })

    await t.test('allows wanderstories.space and subdomains', () => {
        assert.equal(isOriginAllowed('https://wanderstories.space'), true)
        assert.equal(isOriginAllowed('https://images.wanderstories.space'), true)
        assert.equal(isOriginAllowed('https://cdn.wanderstories.space'), true)
    })

    await t.test('rejects unauthorized third-party origins', () => {
        assert.equal(isOriginAllowed('https://evil.com'), false)
        assert.equal(isOriginAllowed('https://attacker.wanderstories.space.evil.com'), false)
        assert.equal(isOriginAllowed('http://wanderstories.space'), false) // non-https
    })
})

test('HTTP server integration', async (t) => {
    let server
    let baseUrl

    await t.test('setup server', async () => {
        await new Promise((resolve) => {
            server = http.createServer(app)
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port
                baseUrl = `http://127.0.0.1:${port}`
                resolve()
            })
        })
    })

    await t.test('GET / responds 200 with service name', async () => {
        const res = await fetch(`${baseUrl}/`)
        assert.equal(res.status, 200)
        const text = await res.text()
        assert.equal(text, 'Wanderstories Video Watermarker')
    })

    await t.test('GET /favicon.ico responds 200', async () => {
        const res = await fetch(`${baseUrl}/favicon.ico`)
        assert.equal(res.status, 200)
    })

    await t.test('GET invalid video path responds 400', async () => {
        const res = await fetch(`${baseUrl}/content/images/videos/invalid`)
        assert.equal(res.status, 400)
    })

    await t.test('GET non-mp4 format responds 400', async () => {
        const res = await fetch(`${baseUrl}/content/images/videos/invalid.avi`)
        assert.equal(res.status, 400)
    })

    await t.test('CORS blocks unauthorized origins with 403', async () => {
        const res = await fetch(`${baseUrl}/`, {
            headers: { Origin: 'https://evil.com' },
        })
        assert.equal(res.status, 403)
        const text = await res.text()
        assert.equal(text, 'Not allowed by CORS')
    })

    await t.test('CORS allows wanderstories.space origin', async () => {
        const res = await fetch(`${baseUrl}/`, {
            headers: { Origin: 'https://wanderstories.space' },
        })
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('access-control-allow-origin'), 'https://wanderstories.space')
        assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
    })

    await t.test('POST without CSRF token responds with 403 Forbidden', async () => {
        const res = await fetch(`${baseUrl}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        })
        assert.equal(res.status, 403)
        const text = await res.text()
        assert.equal(text, 'Invalid CSRF token')
    })

    await t.test('teardown server', async () => {
        await new Promise((resolve) => server.close(resolve))
    })
})

test('cleanTempDir and evictCacheIfNeeded cache management', async (t) => {
    const testDir = path.join(os.tmpdir(), `ws-test-${Date.now()}`)
    fs.mkdirSync(testDir, { recursive: true })

    await t.test('cleanTempDir removes all files in target directory', async () => {
        fs.writeFileSync(path.join(testDir, 'temp1.txt'), 'hello')
        fs.writeFileSync(path.join(testDir, 'temp2.txt'), 'world')
        assert.equal(fs.readdirSync(testDir).length, 2)

        await cleanTempDir(testDir)
        assert.equal(fs.readdirSync(testDir).length, 0)
    })

    await t.test('evictCacheIfNeeded prunes oldest files when size exceeds maxBytes', async () => {
        const fileA = path.join(testDir, 'fileA.mp4')
        const fileB = path.join(testDir, 'fileB.mp4')
        const fileC = path.join(testDir, 'fileC.mp4')

        // Write 100 bytes each (total 300 bytes)
        fs.writeFileSync(fileA, Buffer.alloc(100, 1))
        fs.writeFileSync(fileB, Buffer.alloc(100, 2))
        fs.writeFileSync(fileC, Buffer.alloc(100, 3))

        // Set mtimes: A oldest, B middle, C newest
        const past = Date.now() - 100000
        fs.utimesSync(fileA, (past - 20000) / 1000, (past - 20000) / 1000)
        fs.utimesSync(fileB, (past - 10000) / 1000, (past - 10000) / 1000)
        fs.utimesSync(fileC, past / 1000, past / 1000)

        // Evict if over 250 bytes (target 90% = 225 bytes)
        await evictCacheIfNeeded(testDir, 250, 0)

        // fileA should have been evicted first
        assert.equal(fs.existsSync(fileA), false)
        assert.equal(fs.existsSync(fileC), true)
    })

    await t.test('evictCacheIfNeeded never evicts the excluded path', async () => {
        const keep = path.join(testDir, 'keep.mp4')
        const drop = path.join(testDir, 'drop.mp4')

        fs.writeFileSync(keep, Buffer.alloc(100, 4))
        fs.writeFileSync(drop, Buffer.alloc(100, 5))

        // Make the excluded file the oldest so it would normally be evicted first.
        const older = (Date.now() - 60000) / 1000
        fs.utimesSync(keep, older, older)
        fs.utimesSync(drop, Date.now() / 1000, Date.now() / 1000)

        await evictCacheIfNeeded(testDir, 150, 0, keep)

        assert.equal(fs.existsSync(keep), true)
        assert.equal(fs.existsSync(drop), false)
    })

    await t.test('evictCacheIfNeeded prunes expired files when TTL is exceeded', async () => {
        const expiredFile = path.join(testDir, 'expired.mp4')
        const freshFile = path.join(testDir, 'fresh.mp4')

        fs.writeFileSync(expiredFile, 'data')
        fs.writeFileSync(freshFile, 'data')

        // Set expiredFile mtime to 1 hour ago
        const oneHourAgo = (Date.now() - 3600 * 1000) / 1000
        fs.utimesSync(expiredFile, oneHourAgo, oneHourAgo)

        // TTL is 30 minutes (1800000 ms)
        await evictCacheIfNeeded(testDir, 0, 1800000)

        assert.equal(fs.existsSync(expiredFile), false)
        assert.equal(fs.existsSync(freshFile), true)
    })

    await t.test('cleanup test directory', () => {
        fs.rmSync(testDir, { recursive: true, force: true })
    })
})
