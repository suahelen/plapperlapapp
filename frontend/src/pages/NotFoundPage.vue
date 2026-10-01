<template>
  <main class="container" style="text-align: center; padding-top: 64px">
    <h1>{{ $t('notFound.title') }}</h1>
    <p class="muted">{{ $t('notFound.text') }}</p>
    <RouterLink to="/" class="btn">{{ $t('notFound.home') }}</RouterLink>
  </main>
</template>
