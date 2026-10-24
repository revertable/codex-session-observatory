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
    resolveNavigatorSession,
    exportNavigatorWorklog,
  } from './lib/tauri-bridge'
  import SessionHeader from './lib/control-room/SessionHeader.svelte'
  import SpecializedSessionPanel from './lib/control-room/SpecializedSessionPanel.svelte'
  import TranscriptActions from './lib/control-room/TranscriptActions.svelte'
  import { cancelPanelScroll } from './lib/control-room/panel-scroll'
  import PanelScrollActions from './lib/control-room/PanelScrollActions.svelte'
  import AppLayout from './lib/control-room/AppLayout.svelte'
  import SessionNavigator from './lib/session-navigator/SessionNavigator.svelte'
  import type { SessionSummary, NavigatorTarget } from './lib/session-navigator/contract'
  import type { ExportWorklogResponse } from './lib/worklog-contract'
  import { sessionPathKey } from './lib/session-navigator/state'
  import TranscriptViewer from './lib/rendering/TranscriptViewer.svelte'
  import CollectionPanel from './lib/collection/CollectionPanel.svelte'
  import {
    createCollectionState, collectionForSelectedPath, identifyMessages,
    toggleCollectedMessage, clearCollection,
  } from './lib/collection/collection-state'
  import { serializeTranscript } from './lib/rendering/transcript-capture'
  import { transcriptScopeChanged } from './lib/rendering/transcript-scope'
  import {
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
  let collection = createCollectionState()
  let sessionsOpen = true
  let transcriptViewport: HTMLElement | undefined
  let loadGeneration = 0
  $: messageIds = identifyMessages(
    workflow.selected_file.path,
    workflow.all_observations.transcript_blocks,
  )
  $: collectedIds = new Set(collection.items.map(item => item.id))
  $: collectedBlocks = workflow.observations.transcript_blocks.map(block =>
    collectedIds.has(messageIds.get(block) ?? ''),
  )

  function toggleCollection(index: number) {
    const block = workflow.observations.transcript_blocks[index]
    const id = messageIds.get(block)
    if (id !== undefined) {
      const sourceIndex = workflow.all_observations.transcript_blocks.indexOf(block)
      collection = toggleCollectedMessage(collection, id, block, sourceIndex)
    }
  }

  function selectJsonl(path: string) {
    if (sessionPathKey(workflow.selected_file.path) !== sessionPathKey(path)) {
      cancelPanelScroll(transcriptViewport)
      if (transcriptViewport) transcriptViewport.scrollTop = 0
    }
    loadGeneration++
    collection = collectionForSelectedPath(collection, workflow.selected_file.path, path)
    replaceWorkflow(selectPath(workflow, path))
  }

  async function selectNavigatorSession(item: SessionSummary) {
    if (workflow.status === 'loading' || isExportingWorklog || isLocatingParentSession) return
    if (sessionPathKey(workflow.selected_file.path) !== sessionPathKey(item.path)) selectJsonl(item.path)
    actionStatusMessage = ''
    await loadSelectedJsonl(item.path)
  }

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
      cancelPanelScroll(transcriptViewport)
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
      selectJsonl(selectedPath)
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

    const generation = ++loadGeneration

    replaceWorkflow(beginLoad(workflow))
    transcriptActionStatusMessage = ''
    parentSessionStatusMessage = ''

    try {
      const response = await loadAllObservations(path, parseSelectedJsonl)
      if (generation !== loadGeneration) return
      replaceWorkflow(applyParseResponse(workflow, response))
      actionStatusMessage = ''
    } catch (error) {
      if (generation !== loadGeneration) return
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

    loadGeneration++
    replaceWorkflow(createInitialLoadWorkflowState())
    collection = createCollectionState()
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

    await runWorklogExport(() => Promise.resolve(metadata.absolute_path),
      parent => exportWorklog(metadata.absolute_path, parent))
  }

  async function handleNavigatorExport(target: NavigatorTarget): Promise<void> {
    if (isExportingWorklog) return
    return runWorklogExport(() => resolveNavigatorSession(target), parent => exportNavigatorWorklog(target, parent), true)
  }

  async function runWorklogExport(resolveSource: () => Promise<string>, perform: (parent: string) => Promise<ExportWorklogResponse>, rejectError = false): Promise<void> {
    isExportingWorklog = true

    try {
      const path = await resolveSource()
      const parentDirectory = await selectWorklogParentDirectory(path)
      if (parentDirectory === null) {
        if (!rejectError) actionStatusMessage = 'Export cancelled.'
        return
      }

      if (!rejectError) actionStatusMessage = 'Exporting worklog…'
      const result = await perform(parentDirectory)
      if (rejectError) {
        if (!result.folder_opened) throw new Error(result.refreshed
          ? 'Worklog refreshed, but folder could not be opened.'
          : 'Worklog exported, but folder could not be opened.')
        return
      }
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
      if (rejectError) throw apiError
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

      selectJsonl(result.path)
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
    collectionOpen={collection.isOpen}
    {sessionsOpen}
    onToggleSessions={() => { sessionsOpen = !sessionsOpen }}
    onToggleCollection={() => { collection = { ...collection, isOpen: !collection.isOpen } }}
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

  <AppLayout collectionOpen={collection.isOpen} {sessionsOpen} theme={selectedTheme}>
  {#snippet navigator()}
    <SessionNavigator selectedPath={workflow.selected_file.path}
      selectedThreadId={workflow.loaded_file.session?.identity?.thread_id ?? null}
      theme={selectedTheme}
      visible={sessionsOpen}
      selecting={workflow.status === 'loading' || isExportingWorklog || isLocatingParentSession}
      onSelect={selectNavigatorSession} onExport={handleNavigatorExport} />
  {/snippet}
  {#snippet transcript()}
  <TranscriptActions
    status={workflow.status}
    hasSelectedPath={workflow.selected_file.path.trim() !== ''}
    canCaptureTranscript={workflow.loaded_file.session?.capabilities.can_show_transcript === true}
    actionStatusMessage={transcriptActionStatusMessage}
    onCapture={captureTranscript}
    onRefresh={loadSelectedJsonl}
  />
  <section class="transcript-body" aria-label="Transcript view">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable content must be keyboard focusable.) -->
    <article
      bind:this={transcriptViewport}
      class="transcript-viewport panel-scroll" role="region" tabindex="0" aria-label="Transcript content"
    >
      <div class="transcript-content">
      {#if workflow.loaded_file.session !== null && isSpecializedSession(workflow.loaded_file.session)}
        <SpecializedSessionPanel
          session={workflow.loaded_file.session}
          isLocatingParent={isLocatingParentSession}
          parentStatusMessage={parentSessionStatusMessage}
          onOpenParent={openParentSession}
        />
      {:else}
        <TranscriptViewer
          theme={selectedTheme}
          isLoaded={workflow.loaded_file.metadata !== null}
          {publicReleaseStatus}
          observedEventCounts={workflow.loaded_file.observed_event_counts}
          blocks={workflow.observations.transcript_blocks}
          references={workflow.observations.referenced_conversations}
          {collapsedBlocks}
          onToggleBlock={toggleTranscriptBlock}
          {collectedBlocks}
          onToggleCollection={toggleCollection}
        />
      {/if}
      </div>
    </article>
  </section>

  <PanelScrollActions viewport={transcriptViewport} label="Transcript" disabled={workflow.status !== 'loaded'} />
  {/snippet}
  {#snippet panel()}
    <CollectionPanel items={collection.items} theme={selectedTheme}
      onClear={() => { collection = clearCollection(collection) }} />
  {/snippet}
  </AppLayout>
</main>
