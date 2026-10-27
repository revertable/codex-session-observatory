<script lang="ts">
  import { onMount } from 'svelte'
  import { useSearch } from '../search/search-context'
  import { createSearchState, type SearchTarget } from '../search/search-state'
  let { onSearch = () => {} }: {
    onSearch?: (request: { target: 'Session' | 'Transcript'; query: string }) => void
  } = $props()
  const search = useSearch() ?? createSearchState()
  let input: HTMLInputElement
  const target = $derived($search.target)
  const query = $derived($search.draft)
  onMount(() => {
    const find = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault(); event.stopPropagation(); input.focus(); input.select()
    }
    window.addEventListener('keydown', find, true)
    return () => window.removeEventListener('keydown', find, true)
  })
  function handleSearch(event: SubmitEvent) {
    event.preventDefault()
    search.submit()
    onSearch({ target, query })
  }
</script>

<form class="search-row" role="search" aria-label="Search sessions or transcript" onsubmit={handleSearch}>
  <span class="search-row-label">Search</span>
  <div class="search-controls panel-controls">
    <select aria-label="Search target" value={target} onchange={(event) => search.target(event.currentTarget.value as SearchTarget)}>
      <option>Session</option>
      <option>Transcript</option>
    </select>
    <input aria-label="Search query" type="text" bind:this={input} value={query} oninput={(event) => search.input(event.currentTarget.value)}
      placeholder={target === 'Session' ? 'Search all sessions...' : 'Search current transcript...'} />
    <output class="search-summary" aria-label="Search results" aria-live="polite" title={$search.summaries[target]}>{$search.summaries[target]}</output>
    <button type="submit" class="panel-icon-button" aria-label="Search" title="Search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
    </button>
  </div>
</form>
