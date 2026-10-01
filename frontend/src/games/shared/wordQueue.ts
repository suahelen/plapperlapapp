import type { VocabularyItem } from '../types'
import { defaultRng, shuffle, type Rng } from './random'

/**
 * Endless word picker shared by games: every word appears once per pass in random
 * order, and missed words come back a few turns later for another try.
 */
export class WordQueue {
  private queue: VocabularyItem[] = []

  constructor(
    private readonly items: VocabularyItem[],
    private readonly rng: Rng = defaultRng,
  ) {
    if (items.length === 0) throw new Error('WordQueue needs at least one word')
  }

  next(): VocabularyItem {
    if (this.queue.length === 0) {
      this.queue = shuffle(this.items, this.rng)
    }
    return this.queue.shift()!
  }

  /** Schedules a missed word to come back after a short gap. */
  retryLater(item: VocabularyItem, gap = 3) {
    this.queue = this.queue.filter((i) => i.id !== item.id)
    this.queue.splice(Math.min(gap, this.queue.length), 0, item)
  }
}
