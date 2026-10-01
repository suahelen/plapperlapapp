<script setup lang="ts">
import type { Balloon } from './types'

defineProps<{ balloon: Balloon; duration: number; paused: boolean }>()
const emit = defineEmits<{ tap: []; gone: [] }>()
</script>

<template>
  <!-- The outer element floats upwards; the inner one handles the pop, so popping doesn't reset the position. -->
  <div
    class="float motion-essential"
    :class="{ paused: paused || balloon.popped }"
    :style="{ left: `${balloon.x}%`, animationDuration: `${duration}s`, animationDelay: `${balloon.delay}s` }"
    @animationend.self="emit('gone')"
  >
    <button
      class="balloon"
      :class="balloon.popped ?? ''"
      type="button"
      :disabled="!!balloon.popped"
      :style="{ '--b': balloon.color }"
      @pointerdown.prevent="emit('tap')"
      @keydown.enter.prevent="emit('tap')"
      @keydown.space.prevent="emit('tap')"
    >
      <svg viewBox="0 0 100 150" aria-hidden="true">
        <path d="M50 118 C 49 128, 55 134, 50 150" class="string" />
        <path d="M44 116 L56 116 L50 106 Z" class="knot" />
        <ellipse cx="50" cy="56" rx="44" ry="52" class="body" />
        <ellipse cx="33" cy="34" rx="10" ry="16" class="shine" transform="rotate(-20 33 34)" />
      </svg>
      <span class="label">{{ balloon.text }}</span>
      <span v-if="balloon.popped" class="burst" aria-hidden="true">
        <i v-for="n in 8" :key="n" :style="{ rotate: `${n * 45}deg` }" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.float {
  position: absolute;
  top: 100%;
  width: clamp(92px, 24vw, 130px);
  translate: -50% 0;
  animation-name: rise;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
.float.paused {
  animation-play-state: paused;
}
@keyframes rise {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(calc(-100cqh - 100%));
  }
}
.balloon {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  animation: sway 2.6s ease-in-out infinite alternate;
}
.balloon:disabled {
  cursor: default;
}
.balloon svg {
  display: block;
  width: 100%;
  overflow: visible;
  filter: drop-shadow(0 6px 6px var(--drop-shadow));
}
.body {
  fill: var(--b);
}
.knot {
  fill: color-mix(in srgb, var(--b) 80%, var(--shade));
}
.string {
  fill: none;
  stroke: var(--balloon-string);
  stroke-width: 1.5;
}
.shine {
  fill: var(--surface-bright);
  opacity: 0.35;
}
.label {
  position: absolute;
  top: 8%;
  left: 12%;
  width: 76%;
  height: 58%;
  display: grid;
  place-items: center;
  color: var(--on-color);
  font: 800 clamp(0.85rem, 3.4vw, 1.05rem) var(--font-display);
  line-height: 1.1;
  text-align: center;
  text-shadow: 0 1px 2px var(--text-shadow);
  overflow-wrap: anywhere;
  pointer-events: none;
}
.balloon:focus-visible .body {
  stroke: var(--ink);
  stroke-width: 3;
}
@keyframes sway {
  from {
    transform: rotate(-4deg);
  }
  to {
    transform: rotate(4deg);
  }
}

/* popping */
.hit svg,
.hit .label,
.miss svg,
.miss .label {
  animation: pop 0.28s ease-out forwards;
}
.miss .body {
  fill: var(--balloon-popped);
}
@keyframes pop {
  60% {
    transform: scale(1.25);
    opacity: 0.8;
  }
  to {
    transform: scale(1.4);
    opacity: 0;
  }
}
.burst {
  position: absolute;
  top: 37%;
  left: 50%;
  pointer-events: none;
}
.burst i {
  position: absolute;
  width: 6px;
  height: 14px;
  margin: -7px -3px;
  border-radius: 3px;
  background: var(--b);
  animation: shard 0.45s ease-out forwards;
}
.miss .burst i {
  background: var(--balloon-popped);
}
@keyframes shard {
  from {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateY(-46px) scale(0.4);
    opacity: 0;
  }
}
</style>
