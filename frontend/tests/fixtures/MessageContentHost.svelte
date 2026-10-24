<script lang="ts">
  import { createStatusController } from '../../src/lib/control-room/status-line'
  import { provideStatus } from '../../src/lib/control-room/status-context'
  import StatusLine from '../../src/lib/control-room/StatusLine.svelte'
  const feedback = createStatusController()
  provideStatus(feedback)
  import type { Component as SvelteComponent } from 'svelte'
  let { component: Component, props }: { component: SvelteComponent<any>; props: Record<string, unknown> } = $props()
  let current = $state.raw(props)
  export function replace(next: Record<string, unknown>) { current = next }
</script>
<Component {...current} />

<StatusLine {feedback} />
