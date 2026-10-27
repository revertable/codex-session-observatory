import { getContext, setContext } from 'svelte'
import type { SearchController } from './search-state'
const key = Symbol('application-search')
export const provideSearch = (search: SearchController) => setContext(key, search)
export const useSearch = () => getContext<SearchController | undefined>(key)
