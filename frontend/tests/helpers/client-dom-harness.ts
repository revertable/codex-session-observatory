import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function browserExecutable(): Promise<string> {
  const candidates = [process.env.OBSERVATORY_TEST_BROWSER, process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Browser integration requires installed Chrome/Edge/Chromium. Set OBSERVATORY_TEST_BROWSER to its executable. npm test has no browser requirement.')
}

/** Real client DOM tests, isolated profile and localhost server; no browser download. */
export async function startClientHarness(options: { entry?: string; plugins?: Plugin[]; minify?: boolean } = {}) {
  const executable = await browserExecutable()
  const cache = join(frontend, 'node_modules/.cache/client-dom-tests')
  await mkdir(cache, { recursive: true })
  const directory = await mkdtemp(join(cache, 'run-'))
  const index = join(directory, 'index.html')
  const entry = options.entry ?? join(frontend, 'tests/helpers/message-dom-client.ts').replaceAll('\\', '/')
  await writeFile(join(directory, 'entry.ts'), `import ${JSON.stringify(entry)};`)
  await writeFile(index, '<div id="target"></div><script type="module" src="/entry.ts"></script>')
  let browser: ReturnType<typeof spawn> | undefined
  let socket: WebSocket | undefined
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      const file = resolve(directory, 'dist', path === '/' ? 'index.html' : '.' + path)
      if (!file.startsWith(resolve(directory, 'dist') + sep)) {
        response.writeHead(403).end(); return
      }
      const data = await readFile(file)
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(data)
    } catch { response.writeHead(404).end() }
  })
  const connections = new Set<import('node:net').Socket>()
  server.on('connection', connection => { connections.add(connection); connection.on('close', () => connections.delete(connection)) })
  async function close() {
    try { socket?.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch { /* Browser may already be closed. */ }
    socket?.close()
    if (browser && browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser!.once('exit', resolve)), delay(1500)])
      if (browser.exitCode === null) browser.kill()
    }
    for (const connection of connections) connection.destroy()
    server.close()
    // mkdtemp created this exact directory beneath the test cache.
    if (dirname(directory) !== cache) throw new Error('Unexpected browser test cleanup path')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  try {
    await build({ root: directory, base: './', configFile: false, logLevel: 'silent',
      plugins: [...(options.plugins ?? []), svelte({ compilerOptions: { dev: false } })],
      build: { outDir: join(directory, 'dist'), emptyOutDir: true, minify: options.minify ?? false, rollupOptions: { input: index } } })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const profile = join(directory, 'profile')
    browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-features=BackForwardCache', '--window-size=1220,820', 'about:blank'], { stdio: 'ignore', windowsHide: true })
    let port = ''
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) }
    }
    if (!port) throw new Error('Browser did not expose its diagnostic port')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]
    socket = new WebSocket(targets.find(target => target.type === 'page')!.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => { socket!.addEventListener('open', () => resolve(), { once: true }); socket!.addEventListener('error', reject, { once: true }) })
    let sequence = 0
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const listeners = new Set<(message: { method: string; params: any }) => void>()
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id); clearTimeout(request.timer)
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result)
      } else for (const listener of listeners) listener(message)
    })
    function send(method: string, params: object = {}): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser diagnostic timeout: ${method}`)) }, 30000)
        pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params }))
      })
    }
    async function evaluate<T = any>(expression: string): Promise<T> {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    await send('Page.enable')
    const address = server.address() as { port: number }
    await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('globalThis.__domReady === true')) return {
        send, evaluate, close, port,
        readBuiltScript: async () => {
          const assets = join(directory, 'dist/assets')
          const script = (await readdir(assets)).find(name => name.endsWith('.js'))!
          return readFile(join(assets, script), 'utf8')
        },
        onEvent: (listener: (message: { method: string; params: any }) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      }
      await delay(100)
    }
    throw new Error('Client test module did not initialize')
  } catch (error) { await close(); throw error }
}
