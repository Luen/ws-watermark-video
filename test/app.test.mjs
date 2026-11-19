import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { app, isValidPath, isOriginAllowed } from '../index.mjs'

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
