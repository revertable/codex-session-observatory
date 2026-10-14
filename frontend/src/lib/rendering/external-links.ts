import { openUrl } from '@tauri-apps/plugin-opener'

export function validatedExternalUrl(destination: string): string | null {
  // Validate the final Markdown destination, never the undecoded source label.
  const lower = destination.toLowerCase()
  if ((!lower.startsWith('https://') && !lower.startsWith('http://'))
    || [...destination].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char.charCodeAt(0) === 92)) return null
  try {
    const url = new URL(destination)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export async function openExternalLink(
  destination: string,
  opener: (url: string) => Promise<void> = openUrl,
): Promise<void> {
  const url = validatedExternalUrl(destination)
  if (url === null) throw new Error('Unsupported external URL')
  await opener(url)
}
