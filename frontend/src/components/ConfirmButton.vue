<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

// Two-step button for destructive actions: first click arms it, second click confirms.
defineProps<{ label: string; confirmLabel: string }>()
const emit = defineEmits<{ confirm: [] }>()

const armed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function click() {
  if (armed.value) {
    clearTimeout(timer)
    armed.value = false
    emit('confirm')
    return
  }
  armed.value = true
  timer = setTimeout(() => (armed.value = false), 3000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="btn btn-ghost btn-danger" :class="{ armed }" @click="click">
    {{ armed ? confirmLabel : label }}
  </button>
</template>

<style scoped>
.armed {
  background: var(--bad-soft);
}
</style>
