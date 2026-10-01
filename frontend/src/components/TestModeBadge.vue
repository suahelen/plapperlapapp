<script setup lang="ts">
import { ref } from 'vue'

// Shown only in test mode (`npm run dev`), where the API is simulated in the browser.
const open = ref(false)

async function reset() {
  const { resetMockDb } = await import('@/api/mock')
  resetMockDb()
  window.location.href = '/activities'
}
</script>

<template>
  <div class="test-mode">
    <button type="button" class="pill" :aria-expanded="open" @click="open = !open">🧪 Testmodus</button>
    <div v-if="open" class="panel card">
      <p>
        Die API wird im Browser simuliert – kein Backend, keine Datenbank. Änderungen bleiben in diesem Browser
        gespeichert.
      </p>
      <nav class="links">
        <RouterLink to="/activities" @click="open = false">Aktivitäten</RouterLink>
        <RouterLink to="/vocabulary" @click="open = false">Wortschatz</RouterLink>
        <RouterLink to="/login" @click="open = false">Login</RouterLink>
        <RouterLink to="/play/DEMO2345" @click="open = false">Schüleransicht (Demo)</RouterLink>
        <RouterLink to="/play/FRANZ234" @click="open = false">Schüleransicht (Französisch, Schiffe versenken)</RouterLink>
      </nav>
      <button type="button" class="btn btn-danger" @click="reset">Demo-Daten zurücksetzen</button>
    </div>
  </div>
</template>

<style scoped>
.test-mode {
  position: fixed;
  left: 12px;
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 200;
}
.pill {
  padding: 6px 12px;
  border: 1.5px solid var(--testmode-edge);
  border-radius: 999px;
  background: var(--testmode-bg);
  color: var(--testmode-ink);
  font: 700 0.8rem var(--font);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}
.panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: min(300px, calc(100vw - 24px));
  padding: 14px;
  box-shadow: var(--shadow-lg);
  font-size: 0.9rem;
}
.panel p {
  margin: 0 0 10px;
  color: var(--muted);
}
.links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
</style>
