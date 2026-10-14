<script lang="ts">
  import type { Component as SvelteComponent } from 'svelte'
  let { component: Component, props }: { component: SvelteComponent<any>; props: Record<string, unknown> } = $props()
  let current = $state.raw(props)
  export function replace(next: Record<string, unknown>) { current = next }
</script>
<Component {...current} />
