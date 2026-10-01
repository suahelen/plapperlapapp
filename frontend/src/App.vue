<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'

// Inline env check (not the imported flag) so production builds drop the badge entirely.
const TestModeBadge =
  import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true'
    ? defineAsyncComponent(() => import('./components/TestModeBadge.vue'))
    : null

const route = useRoute()
// Student-facing pages render without the teacher navigation.
const isPlay = computed(() => route.meta.play === true)
</script>

<template>
  <AppHeader v-if="!isPlay" />
  <RouterView />
  <component :is="TestModeBadge" v-if="TestModeBadge" />
</template>
