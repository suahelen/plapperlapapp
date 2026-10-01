<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { playerName } from './names'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QrCode from '@/components/QrCode.vue'
import type { Room } from './useRoom'
import { seatColor } from './colors'

/**
 * Create-or-join screen for room games, followed by the lobby: room code, QR code for
 * the other devices and the list of joined players. With `autoStart` (Schiffe
 * versenken) the game begins once the room is full; otherwise the host starts it.
 */
const props = defineProps<{
  room: Room<unknown>
  title: string
  icon: string
  intro: string
  minPlayers: number
  maxPlayers: number
  /** Joined player names (from the game's view); empty before joining. */
  players?: string[]
  autoStart?: boolean
}>()
const emit = defineEmits<{ start: [] }>()
const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const code = ref('')

const NAME_KEY = 'plapperlapapp-player-name'
const name = ref(readName())

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
function rememberName() {
  try {
    localStorage.setItem(NAME_KEY, name.value.trim())
  } catch {
    // not essential
  }
}

const ticket = computed(() => props.room.ticket.value)
const isHost = computed(() => ticket.value?.seat === 0)
const online = computed(() => props.room.envelope.value?.online ?? [])
const playerList = computed(() => props.players ?? [])
const canStart = computed(() => isHost.value && playerList.value.length >= props.minPlayers)
const deviceLabel = computed(() =>
  props.minPlayers === props.maxPlayers
    ? t('room.devices', { n: props.maxPlayers })
    : t('room.devicesRange', { min: props.minPlayers, max: props.maxPlayers }),
)

const joinUrl = computed(() =>
  ticket.value ? `${window.location.origin}/play/${route.params.publicId}/${route.params.gameId}?room=${ticket.value.code}` : '',
)

onMounted(() => {
  const fromLink = route.query.room
  if (typeof fromLink === 'string' && fromLink) props.room.join(fromLink, name.value)
})

function rememberRoom() {
  // Put the room in the URL so a reload reconnects.
  if (ticket.value) router.replace({ query: { ...route.query, room: ticket.value.code } })
}

async function create() {
  rememberName()
  await props.room.create(name.value)
  rememberRoom()
}

async function join() {
  if (code.value.trim().length < 6) return
  rememberName()
  await props.room.join(code.value, name.value)
  rememberRoom()
}
</script>

<template>
  <div class="lobby card">
    <div class="icon" aria-hidden="true">{{ icon }}</div>
    <h2>{{ title }}</h2>

    <!-- lobby -->
    <template v-if="ticket">
      <p class="muted">{{ t('room.invite') }}</p>
      <div class="code" :aria-label="t('room.codeLabel')">{{ ticket.code }}</div>
      <QrCode :value="joinUrl" :size="180" class="qr" />

      <ul v-if="playerList.length" class="players" :aria-label="t('room.players')">
        <li v-for="(p, i) in playerList" :key="i" :style="{ '--c': seatColor(i) }">
          <i class="dot" />
          <span class="pname">{{ playerName(p, i) }}</span>
          <small v-if="i === ticket.seat" class="muted">{{ t('room.you') }}</small>
          <small v-if="i === 0" class="host">{{ t('room.host') }}</small>
          <span class="status" :class="{ on: online[i] }" :title="online[i] ? t('room.connected') : t('room.disconnected')" />
        </li>
      </ul>

      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <template v-if="autoStart">
        <p class="waiting"><span class="blink" /><span class="blink" /><span class="blink" /> {{ t('room.waitingPlayers') }}</p>
      </template>
      <template v-else-if="isHost">
        <button class="btn btn-primary btn-lg" type="button" :disabled="!canStart || room.busy.value" @click="emit('start')">
          {{ t('room.start') }}
        </button>
        <p v-if="!canStart" class="muted small">{{ t('room.minPlayers', { n: minPlayers }) }}</p>
      </template>
      <p v-else class="waiting"><span class="blink" /><span class="blink" /><span class="blink" /> {{ t('room.waitingStart') }}</p>
    </template>

    <!-- create or join -->
    <template v-else>
      <p class="muted">{{ intro }}</p>
      <div class="badge-row"><span class="badge">👥 {{ deviceLabel }}</span></div>

      <div class="field">
        <label for="player-name">{{ t('room.yourName') }}</label>
        <input id="player-name" v-model="name" class="input" maxlength="20" :placeholder="t('room.namePlaceholder')" autocomplete="nickname" />
      </div>

      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <button class="btn btn-primary btn-lg" type="button" :disabled="room.busy.value" @click="create">
        {{ t('room.newGame') }}
      </button>

      <div class="divider"><span>{{ t('room.or') }}</span></div>

      <form class="join" @submit.prevent="join">
        <input
          v-model="code"
          class="input code-input"
          :placeholder="t('room.codePlaceholder')"
          maxlength="6"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('room.codeLabel')"
        />
        <button class="btn btn-accent" type="submit" :disabled="room.busy.value || code.trim().length < 6">
          {{ t('room.join') }}
        </button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.lobby {
  max-width: 440px;
  margin: 16px auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  padding: 28px 22px;
  text-align: center;
  box-shadow: var(--shadow);
}
.lobby h2,
.lobby p {
  margin: 0;
}
.icon {
  font-size: 3rem;
  line-height: 1;
}
.badge-row {
  display: flex;
  justify-content: center;
}
.field {
  text-align: left;
}
.code {
  font: 800 clamp(2.2rem, 10vw, 3rem) ui-monospace, Consolas, monospace;
  letter-spacing: 0.18em;
}
.qr {
  align-self: center;
  background: var(--surface-bright);
  padding: 8px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
.players {
  list-style: none;
  margin: 0;
  padding: 0;
  text-align: left;
}
.players li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--line);
  animation: pop-in 0.3s var(--ease-bounce);
}
.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
  flex: none;
}
.pname {
  font-weight: 700;
}
.host {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
  font-weight: 700;
}
.status {
  margin-left: auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--line);
}
.status.on {
  background: var(--good);
}
.waiting {
  font-weight: 700;
  color: var(--muted);
}
.small {
  font-size: 0.9rem;
}
.blink {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 2px;
  border-radius: 50%;
  background: var(--muted);
  animation: blink 1s infinite;
}
.blink:nth-child(2) {
  animation-delay: 0.2s;
}
.blink:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
@keyframes pop-in {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 0.9rem;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.join {
  display: flex;
  gap: 8px;
}
.code-input {
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font: 700 1.2rem ui-monospace, Consolas, monospace;
  text-align: center;
}
</style>
