import test from 'node:test'
import assert from 'node:assert/strict'
import { availablePreferences, applyFontPreferences, cssFontFamily, defaultFonts, parseFontPreferences } from '../src/lib/control-room/font-preferences.ts'

test('font preferences restore only installed families and keep Text/Code independent', () => {
  const fonts = [{family:'맑은 고딕',display_name:'맑은 고딕'}, {family:'Consolas',display_name:'Consolas'}]
  assert.deepEqual(parseFontPreferences(null), defaultFonts())
  assert.deepEqual(parseFontPreferences('{"text":7,"code":"Consolas"}'), {text:'',code:'Consolas'})
  assert.deepEqual(availablePreferences({text:'맑은 고딕',code:'Consolas'}, fonts), {text:'맑은 고딕',code:'Consolas'})
  assert.deepEqual(availablePreferences({text:'Removed Font',code:'Consolas'}, fonts), {text:'',code:'Consolas'})
  assert.throws(() => parseFontPreferences('{invalid'))
})

test('font family names remain a quoted single family and Default removes overrides', () => {
  assert.equal(cssFontFamily('A"; color:red; font-family:"B'), '"A\\"; color:red; font-family:\\"B"')
  assert.equal(cssFontFamily('A\\B\n'), '"A\\\\B\\a "')
  const properties = new Map<string,string>()
  const style = { setProperty:(name:string,value:string)=>{properties.set(name,value)}, removeProperty:(name:string)=>{properties.delete(name);return ''} }
  applyFontPreferences(style,{text:'Arial',code:'Consolas'})
  assert.equal(properties.get('--user-text-font'),'"Arial"')
  applyFontPreferences(style,{text:'',code:'Consolas'})
  assert.equal(properties.has('--user-text-font'),false)
  assert.equal(properties.get('--user-code-font'),'"Consolas"')
  applyFontPreferences(style,defaultFonts())
  assert.equal(properties.size,0)
})
