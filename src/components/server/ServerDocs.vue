<script setup lang="ts">
import { IconFileOutline } from '@iconify-prerendered/vue-mdi'

const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div class="server-docs-card">
    <div class="card-icon">
      <a href="https://docs.projectbluefin.io/server/" target="_blank" rel="noopener noreferrer" title="View Server Documentation">
        <img loading="lazy" :src="`${baseUrl}icons/docs.svg`" alt="Bluefin Server Documentation" width="160" height="160">
      </a>
    </div>
    <div class="card-content">
      <h3>Documentation</h3>
      <p>
        Learn how Bluefin Server works under the hood: discoverable disk images (DDIs), offline systemd-sysinstall,
        A/B atomic updates with UKI rollback, and running your home cluster.
      </p>
      <div class="card-buttons">
        <a class="docs-button" href="https://docs.projectbluefin.io/server/" target="_blank" rel="noopener noreferrer">
          <span class="button-icon">
            <IconFileOutline class="size-6" />
          </span>
          <span class="button-label">View Documentation</span>
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.server-docs-card {
  display: flex;
  gap: 24px;
  align-items: center;
  padding: 28px;
  background: rgba(var(--color-bg-rgb), 0.55);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  border: 1px solid var(--color-border);
  box-sizing: border-box;
  width: 100%;

  .card-icon {
    flex-shrink: 0;
    text-align: center;
    max-width: 88px;

    img {
      max-width: 88px;
      height: auto;
      display: block;
    }
  }

  .card-content {
    flex: 1;
    min-width: 0;

    h3 {
      font-size: 2.4rem;
      font-weight: 600;
      color: var(--color-text-light);
      margin: 0 0 10px 0;
    }

    p {
      font-size: 1.5rem;
      line-height: 1.6;
      color: var(--color-text);
      margin: 0 0 18px 0;
    }

    .card-buttons {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .docs-button {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: var(--color-blue);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 1.35rem;
      font-weight: 600;
      transition: background 0.2s ease;

      &:hover {
        background: var(--color-blue-dark, #0056b3);
      }

      .button-icon {
        display: flex;
        align-items: center;

        svg {
          width: 1.8rem;
          height: 1.8rem;
        }
      }
    }
  }

  @media (max-width: 768px) {
    flex-direction: column;
    text-align: center;
    padding: 20px;
    gap: 20px;

    .card-content .card-buttons {
      justify-content: center;
    }
  }
}
</style>
