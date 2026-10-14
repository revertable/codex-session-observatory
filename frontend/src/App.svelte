<script lang="ts">
  import { onMount } from 'svelte'
  import {
    applyParseResponse,
    beginLoad,
    createInitialLoadWorkflowState,
    failLoad,
    loadAllObservations,
    selectPath,
    updateFilter,
    type LoadWorkflowState,
  } from './lib/load-workflow'
  import {
    exportWorklog,
    getAppVersion,
    locateParentSession,
    parseSelectedJsonl,
    selectJsonlPath,
    selectWorklogParentDirectory,
  } from './lib/tauri-bridge'
  import SessionHeader from './lib/control-room/SessionHeader.svelte'
  import SpecializedSessionPanel from './lib/control-room/SpecializedSessionPanel.svelte'
  import TranscriptActions from './lib/control-room/TranscriptActions.svelte'
  import ChatTranscript from './lib/rendering/ChatTranscript.svelte'
  import MarkdownTranscript from './lib/rendering/MarkdownTranscript.svelte'
  import TerminalTranscript from './lib/rendering/TerminalTranscript.svelte'
  import { serializeTranscript } from './lib/rendering/transcript-capture'
  import { transcriptScopeChanged } from './lib/rendering/transcript-scope'
  import {
    renderPathForTheme,
    type TranscriptThemeName,
  } from './lib/rendering/transcript-themes'
  import type { ApiErrorDto } from './lib/parse-contract'
  import { isSpecializedSession } from './lib/specialized-session'
  import { checkPublicReleaseStatus, type PublicReleaseStatus } from './lib/update-check'

  let workflow: LoadWorkflowState = createInitialLoadWorkflowState()
  let actionStatusMessage = ''
  let transcriptActionStatusMessage = ''
  let isExportingWorklog = false
  let isLocatingParentSession = false
  let parentSessionStatusMessage = ''
  let selectedTheme: TranscriptThemeName = 'Terminal Style'
  let collapsedBlocks: Record<number, boolean> = {}
  let publicReleaseStatus: PublicReleaseStatus | null = null

  onMount(() => {
    let active = true

    void getAppVersion()
      .then((currentVersion) => checkPublicReleaseStatus(currentVersion))
      .then((status) => {
        if (active) {
          publicReleaseStatus = status
        }
      })
      .catch(() => {
        // Update availability is optional and must not interrupt the local workflow.
      })

    return () => {
      active = false
    }
  })

  function replaceWorkflow(nextWorkflow: LoadWorkflowState) {
    const shouldResetCollapse = transcriptScopeChanged(
      workflow,
      selectedTheme,
      nextWorkflow,
      selectedTheme,
    )
    workflow = nextWorkflow
    if (shouldResetCollapse) {
      collapsedBlocks = {}
    }
  }

  function replaceTheme(nextTheme: TranscriptThemeName) {
    const shouldResetCollapse = transcriptScopeChanged(
      workflow,
      selectedTheme,
      workflow,
      nextTheme,
    )
    selectedTheme = nextTheme
    if (shouldResetCollapse) {
      collapsedBlocks = {}
    }
  }

  function toggleTranscriptBlock(index: number) {
    collapsedBlocks = {
      ...collapsedBlocks,
      [index]: !(collapsedBlocks[index] ?? false),
    }
  }

  async function chooseJsonlPath() {
    const selectedPath = await selectJsonlPath()

    if (selectedPath !== null) {
      replaceWorkflow(selectPath(workflow, selectedPath))
      actionStatusMessage = ''
      transcriptActionStatusMessage = ''
      parentSessionStatusMessage = ''
      await loadSelectedJsonl(selectedPath)
    }
  }

  async function loadSelectedJsonl(pathOverride?: string) {
    const path = (pathOverride ?? workflow.selected_file.path).trim()

    if (path === '') {
      return
    }

    replaceWorkflow(beginLoad(workflow))
    transcriptActionStatusMessage = ''
    parentSessionStatusMessage = ''

    try {
      const response = await loadAllObservations(path, parseSelectedJsonl)
      replaceWorkflow(applyParseResponse(workflow, response))
      actionStatusMessage = ''
    } catch (error) {
      replaceWorkflow(failLoad(workflow, normalizeLoadError(error)))
      actionStatusMessage = ''
    }
  }

  function handleFilterChange(key: keyof LoadWorkflowState['filter'], value: boolean) {
    replaceWorkflow(updateFilter(workflow, key, value))
    transcriptActionStatusMessage = ''
    parentSessionStatusMessage = ''
  }

  function handleThemeChange(theme: TranscriptThemeName) {
    replaceTheme(theme)
    transcriptActionStatusMessage = ''
    parentSessionStatusMessage = ''
  }

  function resetToIdle() {
    if (isExportingWorklog || isLocatingParentSession) {
      return
    }

    replaceWorkflow(createInitialLoadWorkflowState())
    actionStatusMessage = ''
    transcriptActionStatusMessage = ''
    parentSessionStatusMessage = ''
    replaceTheme('Terminal Style')
  }

  function displayFriendlyPath(path: string) {
    return path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
  }

  async function copyResumeCommand() {
    const command = workflow.loaded_file.metadata?.resume_command

    if (command == null || command.trim() === '') {
      return
    }

    try {
      if (navigator.clipboard == null) {
        throw new Error('Clipboard access is unavailable.')
      }

      await navigator.clipboard.writeText(command)
      actionStatusMessage = 'Copied.'
    } catch {
      actionStatusMessage = 'Copy failed.'
    }
  }

  async function captureTranscript() {
    if (
      workflow.status !== 'loaded' ||
      workflow.loaded_file.session?.capabilities.can_show_transcript !== true
    ) {
      return
    }

    const transcriptText = serializeTranscript({
      theme: selectedTheme,
      blocks: workflow.observations.transcript_blocks,
      references: workflow.observations.referenced_conversations,
      observedEventCounts: workflow.loaded_file.observed_event_counts,
      collapsedBlocks,
    })

    if (transcriptText === '') {
      transcriptActionStatusMessage = 'No transcript text available.'
      return
    }

    try {
      if (navigator.clipboard == null) {
        throw new Error('Clipboard access is unavailable.')
      }

      await navigator.clipboard.writeText(transcriptText)
      transcriptActionStatusMessage = 'Transcript captured.'
    } catch {
      transcriptActionStatusMessage = 'Capture failed.'
    }
  }

  function scrollPageToTop() {
    const startY = window.scrollY

    if (startY === 0) {
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo(0, 0)
      return
    }

    const duration = 200
    const startedAt = performance.now()

    function step(now: number) {
      const progress = Math.min((now - startedAt) / duration, 1)
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      window.scrollTo(0, startY * (1 - easedProgress))

      if (progress < 1) {
        requestAnimationFrame(step)
      }
    }

    requestAnimationFrame(step)
  }

  async function handleExportWorklog() {
    const metadata = workflow.loaded_file.metadata

    if (
      workflow.status !== 'loaded' ||
      metadata === null ||
      workflow.loaded_file.session?.capabilities.can_export_worklog !== true ||
      isExportingWorklog
    ) {
      return
    }

    isExportingWorklog = true

    try {
      const parentDirectory = await selectWorklogParentDirectory(metadata.absolute_path)
      if (parentDirectory === null) {
        actionStatusMessage = 'Export cancelled.'
        return
      }

      actionStatusMessage = 'Exporting worklog…'
      const result = await exportWorklog(metadata.absolute_path, parentDirectory)
      if (!result.folder_opened) {
        actionStatusMessage = result.refreshed
          ? 'Worklog refreshed, but folder could not be opened.'
          : 'Worklog exported, but folder could not be opened.'
      } else {
        actionStatusMessage = result.refreshed
          ? `Worklog refreshed: ${displayFriendlyPath(result.bundle_path)}`
          : `Worklog exported: ${displayFriendlyPath(result.bundle_path)}`
      }
    } catch (error) {
      const apiError = normalizeLoadError(error)
      actionStatusMessage =
        apiError.code === 'target_not_safe_to_overwrite'
          ? 'Target not safe to overwrite.'
          : `Worklog export failed: ${apiError.message}`
    } finally {
      isExportingWorklog = false
    }
  }

  async function openParentSession() {
    const metadata = workflow.loaded_file.metadata
    const session = workflow.loaded_file.session
    const parentThreadId = session?.identity?.parent_thread_id

    if (
      workflow.status !== 'loaded' ||
      metadata === null ||
      session?.capabilities.can_open_parent_session !== true ||
      parentThreadId == null ||
      isLocatingParentSession
    ) {
      return
    }

    isLocatingParentSession = true
    parentSessionStatusMessage = 'Finding parent session locally…'

    try {
      const result = await locateParentSession(metadata.absolute_path, parentThreadId)
      if (
        workflow.loaded_file.metadata?.absolute_path !== metadata.absolute_path ||
        workflow.loaded_file.session?.identity?.parent_thread_id !== parentThreadId
      ) {
        return
      }
      if (result.status !== 'found' || result.path == null) {
        parentSessionStatusMessage = result.message
        return
      }

      replaceWorkflow(selectPath(workflow, result.path))
      await loadSelectedJsonl(result.path)
      if (workflow.status === 'loaded') {
        actionStatusMessage = 'Parent session opened.'
      }
    } catch (error) {
      const apiError = normalizeLoadError(error)
      parentSessionStatusMessage = `Parent session lookup failed: ${apiError.message}`
    } finally {
      isLocatingParentSession = false
    }
  }

  function hasSelectedPath() {
    return workflow.selected_file.path.trim() !== ''
  }

  function normalizeLoadError(error: unknown): ApiErrorDto {
    if (isApiError(error)) {
      return error
    }

    if (error instanceof Error) {
      return { code: 'tauri_command_failed', message: error.message }
    }

    return { code: 'tauri_command_failed', message: String(error) }
  }

  function isApiError(error: unknown): error is ApiErrorDto {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as ApiErrorDto).code === 'string' &&
      typeof (error as ApiErrorDto).message === 'string'
    )
  }
</script>

<main class="control-room">
  <SessionHeader
    status={workflow.status}
    selectedPath={workflow.selected_file.path}
    friendlySelectedPath={workflow.selected_file.path
      ? displayFriendlyPath(workflow.selected_file.path)
      : 'No JSONL path selected.'}
    metadata={workflow.loaded_file.metadata}
    session={workflow.loaded_file.session}
    filter={workflow.filter}
    {selectedTheme}
    {isExportingWorklog}
    {actionStatusMessage}
    errorMessage={workflow.error?.message ?? null}
    onChooseJsonl={chooseJsonlPath}
    onRefresh={loadSelectedJsonl}
    onReset={resetToIdle}
    onCopyResume={copyResumeCommand}
    onExportWorklog={handleExportWorklog}
    onFilterChange={handleFilterChange}
    onThemeChange={handleThemeChange}
  />

  <section class="terminal-section" aria-label="Transcript view">
    <article
      class:terminal-panel={renderPathForTheme(selectedTheme) === 'terminal'}
      class:theme-panel={renderPathForTheme(selectedTheme) !== 'terminal'}
    >
      {#if workflow.loaded_file.session !== null && isSpecializedSession(workflow.loaded_file.session)}
        <SpecializedSessionPanel
          session={workflow.loaded_file.session}
          isLocatingParent={isLocatingParentSession}
          parentStatusMessage={parentSessionStatusMessage}
          onOpenParent={openParentSession}
        />
      {:else if renderPathForTheme(selectedTheme) === 'terminal'}
        <TerminalTranscript
          theme={selectedTheme}
          isLoaded={workflow.loaded_file.metadata !== null}
          {publicReleaseStatus}
          showIdentityNote={workflow.loaded_file.metadata === null}
          observedEventCounts={workflow.loaded_file.observed_event_counts}
          blocks={workflow.observations.transcript_blocks}
          references={workflow.observations.referenced_conversations}
          {collapsedBlocks}
          onToggleBlock={toggleTranscriptBlock}
        />
      {:else if renderPathForTheme(selectedTheme) === 'markdown'}
        <MarkdownTranscript
          theme={selectedTheme}
          isLoaded={workflow.loaded_file.metadata !== null}
          {publicReleaseStatus}
          observedEventCounts={workflow.loaded_file.observed_event_counts}
          blocks={workflow.observations.transcript_blocks}
          references={workflow.observations.referenced_conversations}
          {collapsedBlocks}
          onToggleBlock={toggleTranscriptBlock}
        />
      {:else}
        <ChatTranscript
          theme={selectedTheme as 'DM Style' | 'DM Style (Dark)'}
          isLoaded={workflow.loaded_file.metadata !== null}
          {publicReleaseStatus}
          observedEventCounts={workflow.loaded_file.observed_event_counts}
          blocks={workflow.observations.transcript_blocks}
          references={workflow.observations.referenced_conversations}
          {collapsedBlocks}
          onToggleBlock={toggleTranscriptBlock}
        />
      {/if}
    </article>
  </section>

  <TranscriptActions
    status={workflow.status}
    hasSelectedPath={hasSelectedPath()}
    canCaptureTranscript={workflow.loaded_file.session?.capabilities.can_show_transcript === true}
    actionStatusMessage={transcriptActionStatusMessage}
    onCapture={captureTranscript}
    onTop={scrollPageToTop}
    onRefresh={loadSelectedJsonl}
  />
</main>
