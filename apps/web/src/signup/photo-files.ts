/**
 * Copies the picked files out of a file input, then clears it so the same photo can be picked again.
 * `input.files` is live: clearing the value first leaves it empty, so only the first of several photos was kept.
 */
export function takeFiles<T>(input: { files: ArrayLike<T> | null; value: string }): T[] {
  const files = Array.from(input.files ?? [])
  input.value = ''
  return files
}
