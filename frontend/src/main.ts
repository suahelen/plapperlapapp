import { createApp } from 'vue'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import './theme.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'

createApp(App).use(i18n).use(router).mount('#app')
