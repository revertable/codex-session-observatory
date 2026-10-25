import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startClientHarness } from './helpers/client-dom-harness.ts'
import assert from 'node:assert/strict'

let harness: Awaited<ReturnType<typeof startClientHarness>>
before(async () => { harness = await startClientHarness() }, { timeout: 60000 })
after(async () => { await harness?.close() })

test('allocated Transcript width is shared across themes, content states and panel combinations', { timeout: 120000 }, async () => {
  const app = await startClientHarness({entry:fileURLToPath(new URL('./helpers/navigator-client.ts',import.meta.url)).replaceAll('\\','/')})
  try {
    await app.evaluate('globalThis.__widthStart()')
    for (const state of ['idle','rich','specialized']) {
      if (state !== 'idle') await app.evaluate(`globalThis.__widthLoad(${state === 'specialized'})`)
      for (const [width,height] of [[1100,720],[1360,760],[1920,1080]]) {
        await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
        for (const [left,right] of [[true,true],[false,true],[true,false],[false,false]]) {
          let geometry: string | undefined
          for (const theme of ['Terminal Style','Markdown Style','DM Style','DM Style (Dark)']) {
            const measured = await app.evaluate(`globalThis.__widthCheck(${JSON.stringify(theme)},${left},${right})`)
            const actual = JSON.stringify([measured.frame,measured.viewport])
            if (geometry) assert.equal(actual,geometry,'theme must not change frame or viewport')
            geometry = actual
          }
        }
      }
      if (state === 'rich') {
        await app.evaluate('globalThis.__heightCheck("Terminal Style",true,true)')
        for (const side of ['Sessions','Collection']) {
          await app.evaluate(`document.querySelector('[aria-label="Resize ${side}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`)
          for (const theme of ['Terminal Style','Markdown Style','DM Style','DM Style (Dark)']) {
            await app.evaluate(`globalThis.__widthCheck(${JSON.stringify(theme)},true,true)`)
          }
        }
      }
    }
    await app.evaluate('globalThis.__widthStop()')
  } finally { await app.close() }
})

test('compact header and shared status preserve feedback, recovery and workspace height', { timeout: 60000 }, async () => {
  const app = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\','/') })
  try {
    await app.send('Emulation.setDeviceMetricsOverride',{width:1360,height:760,deviceScaleFactor:1,mobile:false})
    await app.send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await app.evaluate('globalThis.__feedbackCase()')
  } finally { await app.close() }
})

test('theme surfaces preserve common geometry, scroll boundaries and panel control palettes', { timeout: 60000 }, async () => {
  const workspace = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try { await workspace.evaluate('globalThis.__themeSurfaceCase()') }
  finally { await workspace.close() }
})

test('workspace heights fill the visible area and preserve independent scrolling', { timeout: 60000 }, async () => {
  const workspace = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try {
    await workspace.evaluate('globalThis.__heightStart()')
    await workspace.evaluate('globalThis.__heightCheck("Terminal Style",true,true,true)')
    await workspace.evaluate('globalThis.__heightLoad()')
    for (const [width,height] of [[1360,760],[1100,720],[1600,1000]]) {
      await workspace.send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:false })
      for (const theme of ['Terminal Style','DM Style','DM Style (Dark)','Markdown Style']) {
        for (const [left,right] of [[true,true],[false,true],[true,false],[false,false]]) {
          await workspace.evaluate(`globalThis.__heightCheck(${JSON.stringify(theme)},${left},${right})`)
        }
      }
    }
    await workspace.evaluate('globalThis.__heightCheck("Terminal Style",true,true)')
    await workspace.evaluate('globalThis.__heightLong()')
    await workspace.evaluate('globalThis.__independentScrollActions()')
    await workspace.evaluate('globalThis.__backgroundCollectionLong()')
    await workspace.evaluate('globalThis.__workspaceStop()')
  } finally { await workspace.close() }
})

test('session context actions preserve the workspace and support pointer and keyboard interaction', { timeout: 60000 }, async () => {
  const context = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try { await context.evaluate('globalThis.__contextCase()') }
  finally { await context.close() }
})

test('workspace panels resize independently and retain mounted state at minimum, default and wide sizes', { timeout: 60000 }, async () => {
  const workspace = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  // This emulates WebView DPI; native frame/work-area fit is verified separately in Tauri.
  const size = (width: number, height: number, scale = 1) => workspace.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
    screenWidth: Math.round(1920 / scale), screenHeight: Math.round(1080 / scale),
  })
  const bounds = (name: string) => workspace.evaluate(`(() => { const e = document.querySelector('[aria-label="Resize ${name}"]'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:Math.max(r.y+20,Math.min(r.bottom-20,innerHeight-40)),value:Number(e.getAttribute('aria-valuenow'))} })()`)
  const drag = async (name: string, delta: number) => {
    const point = await bounds(name)
    await workspace.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await workspace.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + delta, y: point.y, button: 'left', buttons: 1 })
    await workspace.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + delta, y: point.y, button: 'left', clickCount: 1 })
    await workspace.evaluate('new Promise(r => setTimeout(r, 60))')
    return { before: point.value, after: (await bounds(name)).value }
  }
  try {
    await size(1100, 720)
    await workspace.evaluate('globalThis.__workspaceStart()')
    for (const [width, height, scale] of [[1100,720,1],[1360,760,1],[1360,760,1.25],[1600,1000,1]]) {
      await size(width, height, scale)
      assert.equal(await workspace.evaluate('devicePixelRatio'), scale)
      for (const theme of ['Terminal Style','DM Style (Dark)','DM Style','Markdown Style']) {
        for (const [left,right] of [[true,true],[false,true],[true,false],[false,false]]) {
          await workspace.evaluate(`globalThis.__workspaceCombination(${left},${right},${JSON.stringify(theme)})`)
        }
      }
    }
    await workspace.evaluate('globalThis.__workspaceCombination(true,true,"Terminal Style")')
    const left = await drag('Sessions', 90); assert.ok(left.after > left.before + 80)
    const right = await drag('Collection', -70); assert.ok(right.after > right.before + 60)
    await size(1100,720); await workspace.evaluate('new Promise(r=>setTimeout(r,80))')
    assert.ok((await bounds('Sessions')).value >= 220 && (await bounds('Collection')).value >= 260)
    await size(1600,1000); await workspace.evaluate('new Promise(r=>setTimeout(r,80))')
    assert.equal((await bounds('Sessions')).value, left.after)
    assert.equal((await bounds('Collection')).value, right.after)
    for (const [name, key, code] of [['Sessions','ArrowLeft',37],['Collection','ArrowRight',39]] as const) {
      const prior = await bounds(name)
      await workspace.evaluate(`document.querySelector('[aria-label="Resize ${name}"]').focus()`)
      await workspace.send('Input.dispatchKeyEvent', { type:'keyDown', key, code:key, windowsVirtualKeyCode:code })
      await workspace.send('Input.dispatchKeyEvent', { type:'keyUp', key, code:key, windowsVirtualKeyCode:code })
      assert.equal((await bounds(name)).value, prior.value - 10)
      const point = await bounds(name)
      await workspace.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 })
      await workspace.evaluate(`document.querySelector('[aria-label="Resize ${name}"]').dispatchEvent(new PointerEvent('pointercancel'))`)
      await workspace.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 })
      assert.equal(await workspace.evaluate('document.querySelectorAll(".dragging").length'), 0)
    }
    await size(1100,720)
    const limitedLeft = await drag('Sessions', -2000); assert.equal(limitedLeft.after,220)
    const limitedRight = await drag('Collection', 2000); assert.equal(limitedRight.after,260)
    const capped = await drag('Sessions', 2000); assert.ok(capped.after <= 433)
    await workspace.evaluate('globalThis.__workspaceTree()')
    await workspace.evaluate('globalThis.__workspaceStop()')
  } finally { await workspace.close() }
})

test('default and minimum layouts remain usable under Full HD and 4K DPI emulation', { timeout: 120000 }, async () => {
  const workspace = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try {
    await workspace.evaluate('globalThis.__workspaceStart()')
    // Emulated screen dimensions do not enforce native window constraints or model taskbars.
    for (const [screenWidth, screenHeight, scale] of [
      [1920,1080,1], [1920,1080,1.25],
      [3840,2160,1.5], [3840,2160,2], [3840,2160,2.5], [3840,2160,3],
    ]) {
      for (const [width, height] of [[1360,760], [1100,720]]) {
        await workspace.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: scale, mobile: false,
          screenWidth: Math.round(screenWidth / scale), screenHeight: Math.round(screenHeight / scale),
        })
        const actual = await workspace.evaluate('({width:innerWidth,height:innerHeight,scale:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height})')
        assert.deepEqual(actual, { width, height, scale, screenWidth: Math.round(screenWidth / scale), screenHeight: Math.round(screenHeight / scale) })
        for (const theme of ['Terminal Style','DM Style (Dark)','DM Style','Markdown Style']) {
          await workspace.evaluate(`globalThis.__workspaceCombination(true,true,${JSON.stringify(theme)})`)
        }
        for (const [left,right] of [[false,true],[true,false],[false,false],[true,true]]) {
          await workspace.evaluate(`globalThis.__workspaceCombination(${left},${right},"Terminal Style")`)
        }
      }
    }
    await workspace.evaluate('globalThis.__workspaceStop()')
  } finally { await workspace.close() }
})

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
  'DM inline code is readable in both speaker bubbles without changing other themes or fenced code',
  'empty theme guidance preserves text and gives every role and release state readable contrast',
  'constructor keeps breaks, entities, empty leaves and inert destinations',
  'all four themes preserve original semantic and table assertions and collapse',
  'attachment preserves subtree identity and cleans replacement and unmount listeners',
  'pending and superseded link completions cannot update disposed or newer content',
]) {
  test(name, { timeout: 30000 }, async () => {
    await harness.evaluate(`globalThis.__domCases[${JSON.stringify(name)}]()`)
  })
}


test('filtered messages retain DOM, current handlers, duplicate identity and Refresh across four themes', { timeout: 60000 }, async () => {
  const app = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/filter-reuse-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try { await app.evaluate('globalThis.__filterReuseCase()') }
  finally { await app.close() }
})

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

test('Collection toolbar, notice layout, headers and panel navigation preserve their contracts', { timeout: 60000 }, async () => {
  const collectionHarness = await startClientHarness({
    entry: fileURLToPath(new URL('./helpers/collection-ui-client.ts', import.meta.url)).replaceAll('\\', '/'),
  })
  try { await collectionHarness.evaluate('globalThis.__collectionUiCase()') }
  finally { await collectionHarness.close() }
})


test('system font choices apply independently, restore defaults and persist without changing session data', { timeout: 60000 }, async () => {
  const app = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try { await app.evaluate('globalThis.__fontCase()') }
  finally { await app.close() }
})


test('header halves, appearance selectors and inset arrows contain long values at default and minimum widths', { timeout:60000 }, async () => {
  const app = await startClientHarness({ entry: fileURLToPath(new URL('./helpers/navigator-client.ts', import.meta.url)).replaceAll('\\', '/') })
  try {
    for (const [width,height] of [[1360,760],[1100,720]]) {
      await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      await app.evaluate('globalThis.__headerLayoutCase()')
    }
  } finally { await app.close() }
})
