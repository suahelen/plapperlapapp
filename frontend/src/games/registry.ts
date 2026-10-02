import type { GameDefinition } from './types'
import { eileMitWeileGame } from './eile-mit-weile/definition'
import { balloonPopGame } from './balloon-pop/definition'
import { memoryGame } from './memory/definition'
import { multipleChoiceGame } from './multiple-choice/definition'
import { typingGame } from './typing/definition'
import { kaboomGame } from './kaboom/definition'
import { battleshipGame } from './battleship/definition'
import { tabuGame } from './tabu/definition'

/**
 * All available games. Adding a game means creating its folder (component +
 * definition) and adding one line here — no backend or database change needed.
 */
export const gameRegistry: Record<string, GameDefinition<any>> = {
  [eileMitWeileGame.id]: eileMitWeileGame,
  [balloonPopGame.id]: balloonPopGame,
  [kaboomGame.id]: kaboomGame,
  [battleshipGame.id]: battleshipGame,
  [memoryGame.id]: memoryGame,
  [multipleChoiceGame.id]: multipleChoiceGame,
  [typingGame.id]: typingGame,
  [tabuGame.id]: tabuGame,
}

export function getGame(id: string): GameDefinition<any> | undefined {
  return gameRegistry[id]
}

export function listGames(): GameDefinition<any>[] {
  return Object.values(gameRegistry)
}
