import { getContext, setContext } from 'svelte'
import type { StatusController } from './status-line'
const key = Symbol('application-feedback')
export const provideStatus = (status: StatusController) => setContext(key, status)
export const useStatus = () => getContext<StatusController | undefined>(key)
