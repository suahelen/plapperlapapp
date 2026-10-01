<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { themeColor } from '@/lib/theme'

// Renders the QR code in the browser; only the URL is encoded, nothing is stored.
const props = defineProps<{ value: string; size?: number }>()
const { t } = useI18n()
const canvas = ref<HTMLCanvasElement>()

async function draw() {
  if (!canvas.value) return
  await QRCode.toCanvas(canvas.value, props.value, {
    width: props.size ?? 220,
    margin: 1,
    errorCorrectionLevel: 'M',
    // The canvas can't use CSS variables, so the theme colours are resolved here.
    color: { dark: themeColor('--ink', canvas.value), light: themeColor('--surface-bright', canvas.value) },
  })
}

onMounted(draw)
watch(() => [props.value, props.size], draw)
</script>

<template>
  <canvas ref="canvas" class="qr" role="img" :aria-label="t('common.qrFor', { url: value })" />
</template>

<style scoped>
.qr {
  display: block;
  max-width: 100%;
  height: auto !important;
  border-radius: 12px;
}
</style>
