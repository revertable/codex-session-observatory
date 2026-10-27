import { mount, unmount, flushSync, tick } from 'svelte'
import SearchRow from '../../src/lib/control-room/SearchRow.svelte'
import StatusLine from '../../src/lib/control-room/StatusLine.svelte'
import { createStatusController, type Severity } from '../../src/lib/control-room/status-line'
import '../../src/app.css'
import '../../src/lib/rendering/transcript.css'

const target = document.querySelector('#target') as HTMLElement
const calls: { target: string; query: string }[] = []
const feedback = createStatusController()
const search = mount(SearchRow, { target, props: { onSearch: request => calls.push(request) } })
const toast = mount(StatusLine, { target, props: { feedback, theme: 'Terminal Style' } })
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 30)) }
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }

Object.assign(globalThis, {
  __searchCalls: () => calls,
  __setSearch: async (scope: string) => {
    const select = target.querySelector('select')!
    select.value = scope; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    const input = target.querySelector('input')!
    assert(input.placeholder === (scope === 'Session' ? 'Search all sessions...' : 'Search current transcript...'), 'target placeholder')
    input.focus()
  },
  __toastCase: async (stage: string) => {
    await settle()
    if (stage === 'progress') assert(!target.querySelector('.status-toast'), 'Ready is never displayed')
    const show = async (severity: Severity, message = severity + ' message') => {
      feedback.finish(feedback.begin('test'), severity, message); await settle()
      assert(target.querySelector('.status-toast')?.getAttribute('data-severity') === severity, 'severity ' + severity)
      assert(target.querySelector('.toast-message')?.textContent === message, 'complete message ' + severity)
    }
    if (stage === 'progress') {
      await show('progress')
      await new Promise(resolve => setTimeout(resolve, 4200))
      assert(target.querySelector('.status-toast'), 'active progress stays visible')
      await show('success')
      await new Promise(resolve => setTimeout(resolve, 4200)); await settle()
      assert(!target.querySelector('.status-toast'), 'completion automatically disappears')
    }
    if (stage === 'reading') {
      await show('info')
      const section = target.querySelector<HTMLElement>('.status-toast')!
      section.dispatchEvent(new MouseEvent('mouseenter')); await settle()
      await new Promise(resolve => setTimeout(resolve, 4200))
      assert(target.querySelector('.status-toast'), 'hover pauses dismissal')
      section.dispatchEvent(new MouseEvent('mouseleave')); section.focus(); await settle()
      await new Promise(resolve => setTimeout(resolve, 4200))
      assert(target.querySelector('.status-toast'), 'keyboard focus pauses dismissal')
      section.blur(); await settle()
      await new Promise(resolve => setTimeout(resolve, 4200)); await settle()
      assert(!target.querySelector('.status-toast'), 'dismissal resumes after reading')
    }
    if (stage === 'terminal') {
      await show('warning')
      await new Promise(resolve => setTimeout(resolve, 8200)); await settle()
      assert(!target.querySelector('.status-toast'), 'warning automatically disappears')
      await show('error', 'Action failed. ' + 'long error detail '.repeat(150))
      const announcement = target.querySelector<HTMLElement>('.toast-announcement')!
      assert(announcement.scrollHeight > announcement.clientHeight && announcement.scrollWidth <= announcement.clientWidth, 'long errors wrap and scroll vertically')
      assert(target.querySelector('[role="alert"]'), 'errors are announced assertively')
      await new Promise(resolve => setTimeout(resolve, 12200)); await settle()
      assert(!target.querySelector('.status-toast'), 'error automatically disappears after extended reading time')
      const copy = feedback.begin('copy')
      feedback.finish(copy, 'success', 'Copied after error expiry'); await settle()
      assert(target.querySelector('.toast-message')?.textContent === 'Copied after error expiry', 'expired errors do not mask later operations')
      feedback.clear('copy'); await settle()
    }
    if (stage === 'lifecycle') {
      await show('success', 'Repeated result')
      target.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click(); await settle()
      assert(!target.querySelector('.status-toast'), 'manual dismissal')
      await show('success', 'Repeated result')
      feedback.clear('test'); await settle()
      assert(!target.querySelector('.status-toast'), 'Ready after clear remains hidden')
      const token = feedback.begin('session', 'Session loading', true); await settle()
      feedback.invalidateSession(); await settle()
      assert(!target.querySelector('.status-toast') && !feedback.finish(token, 'error', 'Stale'), 'session invalidation rejects stale feedback')
      const pending = feedback.begin('pending', 'Pending operation'); await settle()
      target.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click(); await settle()
      feedback.begin('unrelated'); await settle()
      assert(!target.querySelector('.status-toast'), 'dismissed progress does not reappear on unrelated updates')
      feedback.finish(pending, 'success', 'Pending completed'); await settle()
      assert(target.querySelector('.toast-message')?.textContent === 'Pending completed', 'dismissing progress preserves its completion token')
      await show('info')
      await unmount(toast); await unmount(search); feedback.dispose()
    }
  },
  __domReady: true,
})
