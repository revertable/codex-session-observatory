<script lang="ts">
  import type { SessionDescriptorDto } from '../parse-contract'
  import { presentationForSession } from '../specialized-session'

  interface Props {
    session: SessionDescriptorDto
    isLocatingParent: boolean
    onOpenParent: () => void | Promise<void>
  }

  let {
    session,
    isLocatingParent,
    onOpenParent,
  }: Props = $props()
  const presentation = $derived(presentationForSession(session))
  const canOpenParent = $derived(
    session.capabilities.can_open_parent_session &&
      session.identity?.parent_thread_id != null &&
      presentation.parentActionLabel !== null,
  )
</script>

<section class="specialized-session" aria-labelledby="specialized-session-title">
  <p class="specialized-session-label">{presentation.label}</p>
  <h2 id="specialized-session-title">{presentation.title}</h2>
  <p class="specialized-session-description">{presentation.description}</p>

  <dl class="specialized-session-identity">
    <div>
      <dt>Current thread ID</dt>
      <dd>{session.identity?.thread_id ?? 'Not provided'}</dd>
    </div>
    <div>
      <dt>Parent thread ID</dt>
      <dd>{session.identity?.parent_thread_id ?? 'Not provided'}</dd>
    </div>
  </dl>

  <div class="specialized-session-actions">
    {#if presentation.parentActionLabel !== null}
      <button
        type="button"
        class="compact-action-button specialized-session-action"
        disabled={!canOpenParent || isLocatingParent}
        onclick={onOpenParent}
      >
        {isLocatingParent ? 'Finding Parent Session…' : presentation.parentActionLabel}
      </button>
    {/if}
    <p class="specialized-session-note">
      The parent is located by thread ID. Inherited child history is not reconstructed.
    </p>

  </div>
</section>
