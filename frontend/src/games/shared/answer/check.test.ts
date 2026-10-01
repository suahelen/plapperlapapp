import { describe, expect, it } from 'vitest'
import cases from '../../../../../shared/answer-cases.json'
import { isCorrect, normalize } from './check'

// Same cases as backend/internal/answer: both checkers must agree, because the server
// validates answers in multiplayer games while single-screen games check in the browser.
describe('answer checking parity with the backend', () => {
  it.each(cases.normalize as [string, string][])('normalize(%j) → %j', (input, want) => {
    expect(normalize(input)).toBe(want)
  })

  it.each(cases.isCorrect as [string, string, boolean][])('isCorrect(%j, %j) → %s', (given, expected, want) => {
    expect(isCorrect(given, expected)).toBe(want)
  })
})
