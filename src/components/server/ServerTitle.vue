<script setup lang="ts">
import { useFadeInUp } from '../../composables'

const { isLoaded } = useFadeInUp()
const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div class="server-title" :class="{ 'is-loaded': isLoaded }">
    <div class="title-inner">
      <div class="title-col-left">
        <div class="hero-tag">
          <strong>Presenting</strong>
        </div>

        <h1 class="hero-title">
          <picture>
            <source
              media="(prefers-color-scheme: light)"
              :srcset="`${baseUrl}brands/bluefin-server-logo-light.svg`"
            >
            <img
              class="server-wordmark"
              :src="`${baseUrl}brands/bluefin-server-logo-dark.svg`"
              alt="Bluefin Server"
              width="500"
              height="240"
              fetchpriority="high"
            >
          </picture>
        </h1>
      </div>

      <div class="title-col-right">
        <p class="title-subtitle">
          Digital Sovereignty Is Not Just for Nations
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../style/setup/mixins';

.server-title {
  width: 100%;
  @include mixins.fade-in-up;
}

.title-inner {
  display: flex;
  flex-direction: row;
  gap: 24px;
}

.title-col-left {
  flex: 7;
}

.title-col-right {
  flex: 3;
  display: flex;
  place-content: center;
}

.title-subtitle {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--color-text-light);
  margin: 0;
  line-height: 1.3;
  text-align: right;
  text-shadow: 0 2px 8px rgba(var(--color-bg-rgb), 0.6);
}

.hero-tag {
  margin-bottom: 2px;

  strong {
    font-size: 1.4rem;
    font-weight: 400;
    font-family: Inter;
    text-transform: uppercase;
    color: var(--color-text-light);
    display: block;
    text-shadow: 0 2px 8px rgba(var(--color-bg-rgb), 0.6);
  }
}

.hero-title {
  margin: 0 0 6px;
  line-height: 1;
  padding: 0;

  picture {
    display: block;
  }
}

.server-wordmark {
  display: block;
  width: min(100%, 440px);
  height: auto;
}

@media (max-width: 640px) {
  .title-inner {
    flex-direction: column;
    gap: 12px;
  }

  .title-subtitle {
    text-align: left;
  }
}
</style>
