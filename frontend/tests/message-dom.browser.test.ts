import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startClientHarness } from './helpers/client-dom-harness.ts'

let harness: Awaited<ReturnType<typeof startClientHarness>>
before(async () => { harness = await startClientHarness() }, { timeout: 60000 })
after(async () => { await harness?.close() })

test('Session Navigator pages, hierarchy, badges, selection and Reload preserve the existing workspace', { timeout: 60000 }, async () => {
  const navigatorHarness = await startClientHarness({
    entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/'),
  })
  try {
    await navigatorHarness.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await navigatorHarness.evaluate('globalThis.__navigatorCase()')
    const point = await navigatorHarness.evaluate('globalThis.__startInfoInputCase()')
    for (const [index, key, code, keyCode] of [[1, 'Enter', 'Enter', 13], [2, ' ', 'Space', 32]] as const) {
      const text = key === 'Enter' ? '\r' : ' '
      await navigatorHarness.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text })
      await navigatorHarness.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
      await navigatorHarness.evaluate(`globalThis.__assertInfoInputCase(${index})`)
    }
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    await navigatorHarness.evaluate('globalThis.__assertInfoInputCase(3)')
    const accessibility = await navigatorHarness.send('Accessibility.getFullAXTree')
    if (!accessibility.nodes.some((node: any) => node.role?.value === 'button' && node.name?.value === 'Title information' && node.description?.value === '01a16795 · Title not found on this device.')) {
      throw new Error('Info must expose its exact tooltip text as an accessible description')
    }
    const rowPoint = await navigatorHarness.evaluate('globalThis.__duplicateRowInputPoint()')
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rowPoint })
    await navigatorHarness.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await navigatorHarness.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await navigatorHarness.evaluate('globalThis.__assertInfoInputCase(3)')
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rowPoint })
    await navigatorHarness.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rowPoint })
    await navigatorHarness.evaluate('globalThis.__assertDuplicateRowInput()')
    await navigatorHarness.evaluate('globalThis.__stopInfoInputCase()')
  }
  finally { await navigatorHarness.close() }
})

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
