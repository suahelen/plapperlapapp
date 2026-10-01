import type { SettingField } from '../types'
import { speechNote } from './answer/speech'

/** Setting fields reused by several games. */

export const directionField: SettingField = {
  key: 'direction',
  label: 'settings.direction.label',
  type: 'select',
  options: [
    { value: 'source-to-target', label: 'settings.direction.forward' },
    { value: 'target-to-source', label: 'settings.direction.backward' },
    { value: 'mixed', label: 'settings.direction.mixed' },
  ],
}

export const answerModesField: SettingField = {
  key: 'answerModes',
  label: 'settings.answerModes.label',
  type: 'multiselect',
  options: [
    { value: 'typed', label: 'settings.answerModes.typed' },
    { value: 'choice', label: 'settings.answerModes.choice' },
    { value: 'spoken', label: 'settings.answerModes.spoken', note: speechNote },
  ],
  // Activities saved before speech input stored a single `answerMode`.
  migrate: (stored) => (typeof stored.answerMode === 'string' ? [stored.answerMode] : undefined),
}
