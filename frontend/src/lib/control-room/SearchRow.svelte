<script lang="ts">
  let { onSearch = () => {} }: {
    onSearch?: (request: { target: 'Session' | 'Transcript'; query: string }) => void
  } = $props()
  let target = $state<'Session' | 'Transcript'>('Session')
  let query = $state('')
  function handleSearch(event: SubmitEvent) {
    event.preventDefault()
    // Execution hook only; search behavior will be implemented separately.
    onSearch({ target, query })
  }
</script>

<form class="search-row" role="search" aria-label="Search sessions or transcript" onsubmit={handleSearch}>
  <span class="search-row-label">Search</span>
  <div class="search-controls panel-controls">
    <select aria-label="Search target" bind:value={target}>
      <option>Session</option>
      <option>Transcript</option>
    </select>
    <input aria-label="Search query" type="text" bind:value={query}
      placeholder={target === 'Session' ? 'Search all sessions...' : 'Search current transcript...'} />
    <button type="submit" class="panel-icon-button" aria-label="Search" title="Search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
    </button>
  </div>
</form>
