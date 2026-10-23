import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startClientHarness } from './helpers/client-dom-harness.ts'

let harness: Awaited<ReturnType<typeof startClientHarness>>
before(async () => { harness = await startClientHarness() }, { timeout: 60000 })
after(async () => { await harness?.close() })

for (const name of [
  'constructor keeps breaks, entities, empty leaves and inert destinations',
  'all four themes preserve original semantic and table assertions and collapse',
  'attachment preserves subtree identity and cleans replacement and unmount listeners',
  'pending and superseded link completions cannot update disposed or newer content',
]) {
  test(name, { timeout: 30000 }, async () => {
    await harness.evaluate(`globalThis.__domCases[${JSON.stringify(name)}]()`)
  })
}


test('App retains transcript through refresh, append and failure while preserving initial load', { timeout: 60000 }, async () => {
  const refreshHarness = await startClientHarness({
    entry: fileURLToPath(new URL('./helpers/refresh-client.ts', import.meta.url)).replaceAll('\\', '/'),
  })
  try { await refreshHarness.evaluate('globalThis.__refreshCase()') }
  finally { await refreshHarness.close() }
})

test('Both Refresh buttons load plain and compressed sessions and preserve Collection across format changes', { timeout: 60000 }, async () => {
  const refreshHarness = await startClientHarness({
    entry: fileURLToPath(new URL('./helpers/refresh-client.ts', import.meta.url)).replaceAll('\\', '/'),
  })
  try { await refreshHarness.evaluate('globalThis.__refreshButtonsCase()') }
  finally { await refreshHarness.close() }
})

test('Collection toolbar, notice layout, headers and page navigation preserve their contracts', { timeout: 60000 }, async () => {
  const collectionHarness = await startClientHarness({
    entry: fileURLToPath(new URL('./helpers/collection-ui-client.ts', import.meta.url)).replaceAll('\\', '/'),
  })
  try { await collectionHarness.evaluate('globalThis.__collectionUiCase()') }
  finally { await collectionHarness.close() }
})
