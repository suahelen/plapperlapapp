import { defineAsyncComponent, type Component } from 'vue'
import ChoiceAnswer from './ChoiceAnswer.vue'
import TypedAnswer from './TypedAnswer.vue'
import type { AnswerMode } from './prompt'
import { speechUsable } from './speech'

/**
 * Registry of answer modalities. Every component receives the same props
 * (`prompt`, `result`, `locked`, `choices?`) and emits `answer` with an AnswerResult,
 * so a new modality (e.g. handwriting) is one entry here plus its component.
 */
export interface AnswerModeDef {
  id: AnswerMode
  /** Message key. */
  label: string
  icon: string
  component: Component
  /** Whether the mode can be used right now on this device. */
  isAvailable(ctx: { choices?: string[] }): boolean
}

export const ANSWER_MODES: Record<AnswerMode, AnswerModeDef> = {
  typed: { id: 'typed', label: 'answer.modes.typed', icon: '⌨️', component: TypedAnswer, isAvailable: () => true },
  choice: {
    id: 'choice',
    label: 'answer.modes.choice',
    icon: '🔘',
    component: ChoiceAnswer,
    isAvailable: (ctx) => !!ctx.choices?.length,
  },
  spoken: {
    id: 'spoken',
    label: 'answer.modes.spoken',
    icon: '🎤',
    // Loaded on demand: recording code is only needed when speech is used.
    component: defineAsyncComponent(() => import('./SpokenAnswer.vue')),
    isAvailable: () => speechUsable(),
  },
}
