import { onBeforeUnmount } from 'vue'

/**
 * Cancellable delays for game sequences. `wait()` promises from before the last
 * `cancelAll()` (or unmount) never resolve, so stale async flows simply stop.
 */
export function useTimers() {
  let generation = 0
  const handles = new Set<ReturnType<typeof setTimeout>>()

  function wait(ms: number): Promise<void> {
    const g = generation
    return new Promise((resolve) => {
      const h = setTimeout(() => {
        handles.delete(h)
        if (g === generation) resolve()
      }, ms)
      handles.add(h)
    })
  }

  function cancelAll() {
    generation++
    handles.forEach(clearTimeout)
    handles.clear()
  }

  onBeforeUnmount(cancelAll)
  return { wait, cancelAll }
}
