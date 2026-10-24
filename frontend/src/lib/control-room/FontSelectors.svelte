<script lang="ts">
  import { onMount } from 'svelte'
  import { listSystemFonts } from '../tauri-bridge'
  import { useStatus } from './status-context'
  import { availablePreferences, applyFontPreferences, defaultFonts, fontPreferenceKey,
    parseFontPreferences, type SystemFont, type FontPreferences } from './font-preferences'

  const feedback = useStatus()!
  let fonts: SystemFont[] = $state([])
  let selected: FontPreferences = $state(defaultFonts())
  let loading = $state(true)

  function save() {
    const token = feedback.begin('font-settings')
    try {
      localStorage.setItem(fontPreferenceKey, JSON.stringify(selected))
      feedback.finish(token)
    } catch {
      feedback.finish(token, 'warning', 'Font choices apply for this session, but could not be saved.')
    }
  }

  function change(kind: 'text' | 'code', family: string) {
    if (fonts.length) feedback.clear('font-list')
    selected = { ...selected, [kind]: family }
    applyFontPreferences(document.documentElement.style, selected)
    save()
  }

  onMount(() => {
    let active = true
    const token = feedback.begin('font-list')
    void listSystemFonts().then(result => {
      if (!active) return
      fonts = result
      let saved: FontPreferences
      try { saved = parseFontPreferences(localStorage.getItem(fontPreferenceKey)) }
      catch {
        feedback.finish(token, 'warning', 'Saved font choices could not be read. Using Default.')
        return
      }
      selected = availablePreferences(saved, fonts)
      applyFontPreferences(document.documentElement.style, selected)
      if (saved.text !== selected.text || saved.code !== selected.code) {
        save()
        feedback.finish(token, 'warning', 'A saved font is not installed on this device. Using Default for that choice.')
      } else feedback.finish(token)
    }).catch(() => {
      if (active) feedback.finish(token, 'error', 'Installed fonts could not be listed. Default fonts remain available.')
    }).finally(() => { if (active) loading = false })
    return () => {
      active = false
      applyFontPreferences(document.documentElement.style, defaultFonts())
    }
  })
</script>

<div class="font-selectors" aria-label="Font settings" aria-busy={loading}>
  {#each (['text', 'code'] as const) as kind}
    <label class="font-selector header-selector">
      <span>{kind === 'text' ? 'Text' : 'Code'}</span>
      <span class="select-field">
      <select aria-label={kind === 'text' ? 'Text font' : 'Code font'}
        title={selected[kind] || 'Default'} value={selected[kind]} disabled={loading}
        onchange={event => change(kind, event.currentTarget.value)}>
        <option value="">Default</option>
        {#each fonts as font (font.family)}
          <option value={font.family}>{font.display_name}</option>
        {/each}
      </select>
      <svg class="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </label>
  {/each}
</div>
