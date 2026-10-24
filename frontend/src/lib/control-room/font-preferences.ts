export interface SystemFont { family: string; display_name: string }
export interface FontPreferences { text: string; code: string }
export const fontPreferenceKey = 'observatory.fonts.v1'
export const defaultFonts = (): FontPreferences => ({ text: '', code: '' })

export function parseFontPreferences(value: string | null): FontPreferences {
  if (!value) return defaultFonts()
  const data: unknown = JSON.parse(value)
  if (!data || typeof data !== 'object') return defaultFonts()
  const o = data as Record<string, unknown>
  return { text: typeof o.text === 'string' ? o.text : '', code: typeof o.code === 'string' ? o.code : '' }
}

export function availablePreferences(saved: FontPreferences, fonts: readonly SystemFont[]): FontPreferences {
  const names = new Set(fonts.map(f => f.family))
  return { text: names.has(saved.text) ? saved.text : '', code: names.has(saved.code) ? saved.code : '' }
}

/** A single CSS string, not a CSS declaration or a comma-separated family list. */
export function cssFontFamily(family: string): string {
  return '"' + family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    .replace(/[\x00-\x1f\x7f]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ') + '"'
}

export function applyFontPreferences(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, fonts: FontPreferences) {
  for (const kind of ['text', 'code'] as const) {
    const property = '--user-' + kind + '-font'
    if (fonts[kind]) style.setProperty(property, cssFontFamily(fonts[kind]))
    else style.removeProperty(property)
  }
}
