import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {chromium} from 'playwright'

async function serveFixture(bundle) {
  const html = `<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>deck.gl compatibility</title></head>
      <body style="margin:0;overflow:hidden">
        <canvas id="deck-canvas" width="320" height="320"></canvas>
        <script>${bundle}</script>
      </body>
    </html>`
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'})
      response.end(html)
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204)
      response.end()
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {server, url: `http://127.0.0.1:${address.port}`}
}

test('renders and updates packed geometry in Chromium', {timeout: 60000}, async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL('./fixture.js', import.meta.url))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false
  })
  const {server, url} = await serveFixture(output.outputFiles[0].text)
  let browser

  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: [
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader'
      ]
    })
    const page = await browser.newPage({viewport: {width: 320, height: 320}, deviceScaleFactor: 1})
    const browserErrors = []
    page.on('pageerror', error => browserErrors.push(error.stack || error.message))
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    await page.goto(url)
    await page.waitForFunction(
      () => window.__deckCompatibility?.status !== 'running',
      undefined,
      {timeout: 30000}
    )
    const result = await page.evaluate(() => window.__deckCompatibility)

    assert.equal(result.status, 'passed', result.error)
    assert.equal(result.hasTopModel, true)
    assert.equal(result.tessellatedIndexCount, result.externalIndexCount)
    assert.equal(result.pickedSourceObject, true)
    assert.ok(result.renderedColor[2] > 200)
    assert.ok(result.renderedColor[0] < 50)
    assert.equal(result.observedTransitionColor, true)
    assert.equal(result.geometryReused, true)
    assert.equal(result.binaryDataReused, true)
    assert.deepEqual(result.updatedColor, [0, 0, 255, 255])
    assert.deepEqual(browserErrors, [])
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
})
