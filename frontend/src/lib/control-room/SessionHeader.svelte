<script lang="ts">
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
    actionStatusMessage: string
    errorMessage: string | null
    onChooseJsonl: () => void | Promise<void>
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
    actionStatusMessage,
    errorMessage,
    onChooseJsonl,
    onRefresh,
    onReset,
    onCopyResume,
    onExportWorklog,
    onFilterChange,
    onThemeChange,
  }: Props = $props()

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

<header class="app-header" aria-labelledby="app-title">
  <div class="toolbar">
    <div class="product-heading">
      <p class="eyebrow">Local transcript viewer</p>
      <h1 id="app-title">Codex Session Observatory</h1>
    </div>

    <div class="toolbar-actions">
      <button type="button" onclick={onChooseJsonl}>Select JSONL</button>

      <label class="selected-path-field">
        <span>Selected JSONL path</span>
        <input
          type="text"
          value={selectedPath}
          placeholder="No JSONL selected"
          readonly
        />
      </label>

      <button
        type="button"
        class="compact-action-button"
        disabled={selectedPath.trim() === ''}
        onclick={() => onRefresh()}
      >
        Refresh
      </button>
      {#if status === 'loaded'}
        <button
          type="button"
          class="status status-reset"
          data-status={status}
          aria-label="Reset loaded session"
          title="Reset to idle"
          disabled={isExportingWorklog}
          onclick={onReset}
        >
          {status}
        </button>
      {:else}
        <span class="status" data-status={status}>{status}</span>
      {/if}
    </div>
  </div>

  <section class="selection-panel" aria-label="Current selection">
    <div class="selected-path-row">
      <span>Selected path</span>
      <strong title={friendlySelectedPath}>{friendlySelectedPath}</strong>
    </div>

    <dl class="selection-metadata">
      <div>
        <dt>File</dt>
        <dd>{metadata?.file_name ?? 'Not loaded'}</dd>
      </div>
      <div>
        <dt>Session ID</dt>
        <dd>{metadata?.session_id ?? 'Not detected'}</dd>
      </div>
      <div>
        <dt>Session type</dt>
        <dd>{specializedPresentation?.label ?? (status === 'loaded' ? 'Ordinary session' : 'Not loaded')}</dd>
      </div>
    </dl>

    <div class="resume-row">
      <span>Resume command</span>
      <code>{specializedPresentation?.resumeUnavailable ?? metadata?.resume_command ?? 'Not available'}</code>
      <div class="resume-actions">
        <button
          type="button"
          class="secondary resume-action-button"
          disabled={session?.capabilities.can_resume !== true || metadata?.resume_command == null}
          onclick={onCopyResume}
        >
          Copy Resume Command
        </button>
        <button
          type="button"
          class="secondary resume-action-button"
          title={specializedPresentation?.exportUnavailable}
          disabled={status !== 'loaded' || session?.capabilities.can_export_worklog !== true || isExportingWorklog}
          onclick={onExportWorklog}
        >
          Export Worklog
        </button>
      </div>
      <span class="action-status" aria-live="polite">{actionStatusMessage}</span>
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
    <div class="view-controls">
    <label class="theme-selector">
      <span>Theme</span>
      <select
        value={selectedTheme}
        onchange={(event) => onThemeChange(event.currentTarget.value as TranscriptThemeName)}
      >
        {#each transcriptThemes as theme}
          <option value={theme}>{theme}</option>
        {/each}
      </select>
    </label>
    <button type="button" class="collection-panel-toggle" class:active={sessionsOpen}
      aria-label={sessionsOpen ? 'Hide Sessions' : 'Show Sessions'}
      title={sessionsOpen ? 'Hide Sessions' : 'Show Sessions'}
      aria-expanded={sessionsOpen} aria-controls="sessions-panel" onclick={onToggleSessions}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5 8h2M5 12h2M5 16h2" />
      </svg>
    </button>
    <button
      type="button"
      class="collection-panel-toggle"
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

  {#if status === 'loading'}
    <p class="status-message" aria-live="polite">Loading the selected JSONL file…</p>
  {:else if status === 'error'}
    <p class="status-message error" aria-live="assertive">
      {errorMessage ?? 'The selected JSONL file could not be loaded.'}
    </p>
  {/if}
</header>
