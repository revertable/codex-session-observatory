<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { RELEASES_PAGE_URL, type PublicReleaseStatus } from '../update-check'

  interface Props {
    releaseStatus: PublicReleaseStatus
    presentation: 'terminal' | 'markdown' | 'chat'
  }

  let { releaseStatus, presentation }: Props = $props()

  async function visitReleases(event: MouseEvent) {
    event.preventDefault()
    await openUrl(RELEASES_PAGE_URL)
  }
</script>

<span class="update-notice" data-status={releaseStatus.status}>
  {#if releaseStatus.status === 'update-available'}
    {#if presentation === 'terminal'}[UPDATE] {/if}New version available: v{releaseStatus.latestVersion}.
    <a href={RELEASES_PAGE_URL} onclick={visitReleases}>[View GitHub Releases]</a>
  {:else if releaseStatus.status === 'current'}
    {#if presentation === 'terminal'}
      [OK] Latest public version: v{releaseStatus.latestVersion}
    {:else if presentation === 'markdown'}
      Latest public version — you’re running v{releaseStatus.latestVersion}.
    {:else}
      Up to date — v{releaseStatus.latestVersion} is the latest public version.
    {/if}
  {:else if presentation === 'terminal'}
    [DEV] Unpublished development version: v{releaseStatus.currentVersion} (latest public: v{releaseStatus.latestVersion}).
  {:else if presentation === 'markdown'}
    Development version — v{releaseStatus.currentVersion} is newer than the latest public release (v{releaseStatus.latestVersion}).
  {:else}
    Development build — v{releaseStatus.currentVersion} is ahead of public v{releaseStatus.latestVersion}.
  {/if}
</span>
