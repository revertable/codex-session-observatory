<script lang="ts">
  import StatusLine from './StatusLine.svelte'
  import FontSelectors from './FontSelectors.svelte'
  import { useStatus } from './status-context'
  import type { LoadStatus } from '../load-workflow'
  import type {
    FilterDto,
    LoadedFileMetadataDto,
    SessionDescriptorDto,
  } from '../parse-contract'
  import { transcriptThemes, type TranscriptThemeName } from '../rendering/transcript-themes'
  import { isSpecializedSession, presentationForSession } from '../specialized-session'

  interface Props {
    status: LoadStatus
    selectedPath: string
    friendlySelectedPath: string
    metadata: LoadedFileMetadataDto | null
    session: SessionDescriptorDto | null
    filter: FilterDto
    selectedTheme: TranscriptThemeName
    collectionOpen: boolean
    sessionsOpen: boolean
    onToggleSessions: () => void
    onToggleCollection: () => void
    isExportingWorklog: boolean
    onRefresh: () => void | Promise<void>
    onReset: () => void
    onCopyResume: () => void | Promise<void>
    onExportWorklog: () => void | Promise<void>
    onFilterChange: (key: keyof FilterDto, value: boolean) => void
    onThemeChange: (theme: TranscriptThemeName) => void
  }

  let {
    status,
    selectedPath,
    friendlySelectedPath,
    metadata,
    session,
    filter,
    selectedTheme,
    collectionOpen,
    sessionsOpen,
    onToggleSessions,
    onToggleCollection,
    isExportingWorklog,
    onRefresh,
    onReset,
    onCopyResume,
    onExportWorklog,
    onFilterChange,
    onThemeChange,
  }: Props = $props()

  const feedback = useStatus()!
  const resetTooltipId = $props.id()
  let resetButton: HTMLButtonElement | undefined = $state()
  let resetTooltip: HTMLSpanElement | undefined = $state()
  let resetHovered = $state(false)
  let resetFocused = $state(false)
  let resetDismissed = $state(false)
  let resetLeft = $state(0)
  let resetTop = $state(0)
  const resetTooltipOpen = $derived((resetHovered || resetFocused) && !resetDismissed)
  function positionResetTooltip() {
    if (!resetButton || !resetTooltip) return
    const anchor = resetButton.getBoundingClientRect()
    resetLeft = Math.max(8, Math.min(anchor.left, window.innerWidth - resetTooltip.getBoundingClientRect().width - 8))
    resetTop = anchor.bottom + 6
  }
  $effect(() => {
    if (!resetTooltipOpen) return
    positionResetTooltip()
    window.addEventListener('resize', positionResetTooltip)
    return () => window.removeEventListener('resize', positionResetTooltip)
  })

  const filterGroups = [
    {
      layer: 'core',
      options: [
        ['show_you', 'You'],
        ['show_codex', 'Codex'],
      ],
    },
    {
      layer: 'observation',
      options: [
        ['show_tool_call', 'Tool calls'],
        ['show_tool_result', 'Tool results'],
        ['show_meta', 'Meta'],
      ],
    },
  ] as const

  const specialized = $derived(isSpecializedSession(session))
  const specializedPresentation = $derived(
    session !== null && specialized ? presentationForSession(session) : null,
  )
</script>

<header class="app-header" data-theme={selectedTheme} aria-labelledby="app-title">
  <div class="toolbar">
    <div class="product-heading">
      <p class="eyebrow">Local transcript viewer</p>
      <h1 id="app-title">Codex Session Observatory</h1>
    </div>

    <div class="header-controls panel-controls">
      <span class="status load-state" data-status={status}>{status === 'loaded' ? 'Loaded' : status[0].toUpperCase() + status.slice(1)}</span>
      <button type="button" class="toolbar-icon-button panel-icon-button" aria-label="Refresh" title="Refresh" disabled={selectedPath.trim() === ''} onclick={() => onRefresh()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></svg>
      </button>
      <button type="button" class="toolbar-icon-button panel-icon-button reset-session-button" aria-label="Reset loaded session" aria-describedby={resetTooltipId}
        bind:this={resetButton} disabled={status !== 'loaded' || isExportingWorklog} onclick={onReset}
        onmouseenter={() => { resetHovered = true; resetDismissed = false }} onmouseleave={() => { resetHovered = false }}
        onfocusin={() => { resetFocused = true; resetDismissed = false }} onfocusout={() => { resetFocused = false }}
        onkeydown={event => { if (event.key === 'Escape') { resetDismissed = true; event.preventDefault() } }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        <span id={resetTooltipId} role="tooltip" class="reset-session-tooltip" class:visible={resetTooltipOpen}
          bind:this={resetTooltip} style:left={`${resetLeft}px`} style:top={`${resetTop}px`}>Reset to idle</span>
      </button>
    </div>
  </div>

  <section class="selection-panel" aria-label="Current selection">
    <div class="selected-path-row">
      <span>Selected path</span>
      <strong title={friendlySelectedPath}>{friendlySelectedPath}</strong>
    </div>

    <div class="session-command-row">
    <dl class="selection-metadata">
      <div>
        <dt>Session ID</dt>
        <dd title={metadata?.session_id ?? 'Not detected'}>{metadata?.session_id ?? 'Not detected'}</dd>
      </div>
    </dl>

    <div class="resume-row panel-controls">
      <span>Resume command</span>
      <code title={specializedPresentation?.resumeUnavailable ?? metadata?.resume_command ?? 'Not available'}>{specializedPresentation?.resumeUnavailable ?? metadata?.resume_command ?? 'Not available'}</code>
      <button type="button" class="toolbar-icon-button panel-icon-button" aria-label="Copy Resume Command" title="Copy Resume Command" disabled={session?.capabilities.can_resume !== true || metadata?.resume_command == null} onclick={onCopyResume}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H4v13h4" /></svg>
      </button>
    </div>
    </div>
  </section>

  <section class="appearance-row" aria-label="Appearance settings">
    <h2 class="style-label">Style</h2>
    <div class="appearance-controls">
    <label class="theme-selector header-selector">
      <span>Theme</span>
      <span class="select-field">
      <select aria-label="Theme"
        value={selectedTheme}
        onchange={(event) => onThemeChange(event.currentTarget.value as TranscriptThemeName)}
      >
        {#each transcriptThemes as theme}
          <option value={theme}>{theme}</option>
        {/each}
      </select>
      <svg class="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </label>
    <FontSelectors />
    </div>
  </section>

  <section class="filter-bar" aria-label="Transcript filters">
    <h2>Filters</h2>
    <div class="filter-list">
      {#each filterGroups as group}
        <div class="filter-group" data-filter-layer={group.layer}>
          {#each group.options as [key, label]}
            <label>
              <input
                type="checkbox"
                checked={filter[key]}
                onchange={(event) => onFilterChange(key, event.currentTarget.checked)}
              />
              <span>{label}</span>
            </label>
          {/each}
        </div>
      {/each}
    </div>
    <div class="view-controls panel-controls">

    <button type="button" class="toolbar-icon-button panel-icon-button" aria-label="Export Worklog" title={specializedPresentation?.exportUnavailable ?? 'Export Worklog'} disabled={status !== 'loaded' || session?.capabilities.can_export_worklog !== true || isExportingWorklog} onclick={onExportWorklog}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
    </button>
    <button type="button" class="collection-panel-toggle panel-icon-button" class:active={sessionsOpen}
      aria-label={sessionsOpen ? 'Hide Sessions' : 'Show Sessions'}
      title={sessionsOpen ? 'Hide Sessions' : 'Show Sessions'}
      aria-expanded={sessionsOpen} aria-controls="sessions-panel" onclick={onToggleSessions}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5 8h2M5 12h2M5 16h2" />
      </svg>
    </button>
    <button
      type="button"
      class="collection-panel-toggle panel-icon-button"
      class:active={collectionOpen}
      aria-label={collectionOpen ? 'Hide Collection' : 'Show Collection'}
      title={collectionOpen ? 'Hide Collection' : 'Show Collection'}
      aria-expanded={collectionOpen}
      aria-controls="collection-panel"
      onclick={onToggleCollection}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16M18 8h1M18 12h1M18 16h1" />
      </svg>
    </button>
    </div>
  </section>

  <StatusLine {feedback} />
</header>
