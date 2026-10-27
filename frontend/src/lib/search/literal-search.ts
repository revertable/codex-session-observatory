/** Map Unicode lowercase expansions back to original UTF-16 offsets for DOM Ranges. */
export function literalMatches(text: string, query: string): { start: number; end: number }[] {
  const fold = (value: string) => [...value].map(char => char.toLowerCase()).join('')
  const needle = fold(query.trim())
  if (!needle) return []
  let haystack = '', position = 0
  const starts: number[] = [], ends: number[] = []
  for (const char of text) {
    const lowered = fold(char)
    for (let i = 0; i < lowered.length; i++) { starts.push(position); ends.push(position + char.length) }
    haystack += lowered; position += char.length
  }
  const matches = []
  for (let offset = 0; offset <= haystack.length - needle.length;) {
    const index = haystack.indexOf(needle, offset)
    if (index < 0) break
    matches.push({ start: starts[index], end: ends[index + needle.length - 1] })
    offset = index + needle.length
  }
  return matches
}
