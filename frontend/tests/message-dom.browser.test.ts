import { after, before, test } from 'node:test'
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
