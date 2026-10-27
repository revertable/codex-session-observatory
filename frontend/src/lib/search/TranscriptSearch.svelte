<script lang="ts">
  import { useSearch } from './search-context'
  import { attachTranscriptSearch } from './transcript-search'
  let { viewport, session }: { viewport: HTMLElement | undefined; session: string } = $props()
  const search = useSearch()!
  $effect(() => {
    void session
    if (viewport) return attachTranscriptSearch(viewport, search)
  })
</script>
