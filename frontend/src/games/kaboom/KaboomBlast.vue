<script setup lang="ts">
import { useGameT } from '../i18n'

const gt = useGameT('kaboom')
</script>

<template>
  <!-- The KABOOM explosion, shared by single- and multi-device Kaboom. -->
  <div class="blast" aria-hidden="true">
    <svg viewBox="0 0 200 200">
      <polygon
        points="100,4 120,62 178,30 146,86 196,110 138,124 162,184 104,144 70,196 66,136 8,150 50,104 6,62 68,70 56,10"
        class="burst-outer"
      />
      <polygon
        points="100,34 114,74 152,56 132,92 164,108 126,118 140,156 102,130 78,162 76,124 40,130 66,102 38,76 80,82 74,42"
        class="burst-inner"
      />
    </svg>
    <span class="blast-text">{{ gt('blast') }}</span>
  </div>
</template>

<style scoped>
.blast {
  position: relative;
  width: min(280px, 70vw);
  aspect-ratio: 1;
  animation: blast 0.55s var(--ease-bounce);
}
.blast svg {
  width: 100%;
  height: 100%;
  animation: spin 6s linear infinite;
}
.burst-outer {
  fill: var(--blast-outer);
}
.burst-inner {
  fill: var(--blast-inner);
}
.blast-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 800 clamp(2rem, 9vw, 3rem) var(--font-display);
  color: var(--on-color);
  letter-spacing: 0.02em;
  text-shadow:
    0 3px 0 var(--blast-text-shadow),
    0 0 18px color-mix(in srgb, var(--shade) 25%, transparent);
  transform: rotate(-8deg);
}
@keyframes blast {
  from {
    transform: scale(0.2) rotate(-30deg);
    opacity: 0;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
