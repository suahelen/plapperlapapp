<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const props = defineProps<{
  title: string
  subtitle?: string
  /** 0..1 success ratio, shown as up to three stars. */
  ratio?: number
}>()
const emit = defineEmits<{ again: [] }>()

const stars = computed(() => {
  if (props.ratio === undefined) return null
  if (props.ratio >= 0.9) return 3
  if (props.ratio >= 0.6) return 2
  if (props.ratio >= 0.3) return 1
  return 0
})

// A little confetti burst, generated once.
const confetti = Array.from({ length: 28 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${(i % 7) * 0.08}s`,
  color: ['var(--deco-1)', 'var(--deco-7)', 'var(--deco-3)', 'var(--deco-2)', 'var(--deco-4)'][i % 5],
  rotate: `${(i * 53) % 360}deg`,
}))
const { t } = useI18n()
</script>

<template>
  <div class="result">
    <div v-if="stars !== null && stars > 0" class="confetti" aria-hidden="true">
      <i
        v-for="(c, i) in confetti"
        :key="i"
        :style="{ left: c.left, animationDelay: c.delay, background: c.color, rotate: c.rotate }"
      />
    </div>
    <div class="card inner">
      <div v-if="stars !== null" class="stars" :aria-label="t('game.stars', { n: stars })">
        <span v-for="n in 3" :key="n" :class="{ on: n <= stars }" :style="{ animationDelay: `${n * 0.15}s` }">★</span>
      </div>
      <h2>{{ title }}</h2>
      <p v-if="subtitle" class="muted">{{ subtitle }}</p>
      <slot />
      <button class="btn btn-primary btn-lg" type="button" @click="emit('again')">{{ t('game.again') }}</button>
    </div>
  </div>
</template>

<style scoped>
.result {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 32px 0;
}
.inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  text-align: center;
  padding: 32px 24px;
  box-shadow: var(--shadow);
  animation: rise 0.4s var(--ease-bounce);
}
.stars {
  font-size: 3rem;
  line-height: 1;
  margin-bottom: 12px;
  letter-spacing: 6px;
}
.stars span {
  color: var(--line);
  display: inline-block;
}
.stars span.on {
  color: var(--player-yellow);
  animation: star 0.5s var(--ease-bounce) both;
}
.confetti {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.confetti i {
  position: absolute;
  top: -10px;
  width: 8px;
  height: 14px;
  border-radius: 2px;
  animation: fall 1.8s ease-in forwards;
}
@keyframes rise {
  from {
    transform: translateY(16px) scale(0.96);
    opacity: 0;
  }
}
@keyframes star {
  from {
    transform: scale(0);
  }
}
@keyframes fall {
  to {
    transform: translateY(420px) rotate(540deg);
    opacity: 0;
  }
}
</style>
