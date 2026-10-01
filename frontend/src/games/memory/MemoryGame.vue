<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed, shallowRef } from 'vue'
import type { GameProps } from '../types'
import type { MemorySettings, MemoryState } from './types'
import { createDeck, flip, hideUnmatched } from './logic'
import MemoryBoard from './MemoryBoard.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<MemorySettings>>()
const gt = useGameT('memory')
const { wait, cancelAll } = useTimers()

const state = shallowRef<MemoryState>(createDeck(props.vocabulary, props.settings.pairs))

function restart() {
  cancelAll()
  state.value = createDeck(props.vocabulary, props.settings.pairs)
}

async function onFlip(i: number) {
  state.value = flip(state.value, i)
  if (state.value.flipped.length === 2) {
    await wait(1100)
    state.value = hideUnmatched(state.value)
  }
}

const cards = computed(() =>
  state.value.cards.map((c, i) => ({ text: c.text, side: c.side, matched: c.matched, up: state.value.flipped.includes(i) })),
)
// Perfect play needs one attempt per pair; rate relative to that.
const ratio = computed(() => Math.min(1, state.value.totalPairs / Math.max(1, state.value.attempts - state.value.totalPairs * 0.5)))
</script>

<template>
  <GameShell :title="gt('name')" @restart="restart">
    <template #status>
      <span>{{ gt('progress', { found: state.matchedPairs, total: state.totalPairs, attempts: state.attempts }) }}</span>
    </template>

    <ResultScreen
      v-if="state.finished"
      :title="gt('allFound')"
      :subtitle="gt('attempts', { attempts: state.attempts, pairs: state.totalPairs })"
      :ratio="ratio"
      @again="restart"
    />

    <MemoryBoard v-else :cards="cards" :disabled="state.flipped.length >= 2" @flip="onFlip" />
  </GameShell>
</template>
