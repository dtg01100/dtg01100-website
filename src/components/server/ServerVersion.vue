<script setup lang="ts">
import type { ServerVersions } from '../../composables'
import { IconGithubCircle } from '@iconify-prerendered/vue-mdi'
import { computed, onMounted, ref } from 'vue'
import { getServerVersions } from '../../composables'

const GITHUB_RELEASES_PAGE = 'https://github.com/projectbluefin/server/releases'

const VERSION_LABELS: Record<string, string> = {
  kernel: 'Kernel',
  systemd: 'systemd',
}

const versions = ref<ServerVersions | null>(null)

const versionRows = computed(() => {
  if (!versions.value || versions.value.status !== 'verified') {
    return []
  }
  return Object.entries(versions.value.packages)
    .filter(([key]) => key in VERSION_LABELS)
    .map(([key, value]) => ({
      label: VERSION_LABELS[key],
      value,
    }))
})

onMounted(async () => {
  try {
    versions.value = await getServerVersions()
  }
  catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[ServerVersion] failed to load versions', e)
    }
  }
})
</script>

<template>
  <div class="release-widget">
    <div v-if="versionRows.length > 0" class="version-info">
      <div v-for="row in versionRows" :key="row.label" class="version-row">
        <div class="version-label">
          {{ row.label }}
        </div>
        <div class="version-value">
          {{ row.value }}
        </div>
      </div>
    </div>
    <div class="release-action">
      <div class="action-label">
        Install freedesktop-sdk Server Linux
      </div>
      <p>Choose the release asset for your hardware and follow the installation notes on GitHub.</p>
      <p v-if="versionRows.length === 0">
        Version details will appear when Bluefin Server publishes a verifiable image SBOM.
      </p>
      <a class="release-link" :href="GITHUB_RELEASES_PAGE" target="_blank" rel="noopener noreferrer">
        <IconGithubCircle />
        View releases on GitHub
      </a>
    </div>
  </div>
</template>

<style scoped lang="scss">
.release-widget {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(var(--color-bg-rgb), 0.55);
  backdrop-filter: blur(8px);
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
}

.version-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.version-label {
  color: var(--color-text);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  opacity: 0.7;
  text-transform: uppercase;
}

.version-value {
  color: var(--color-text);
  font-size: 1.1rem;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
}

.release-action {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  background: rgba(var(--color-bg-rgb), 0.35);
}

.action-label {
  color: var(--color-text);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  opacity: 0.65;
  text-transform: uppercase;
}

.release-action p {
  margin: 0;
  color: var(--color-text);
  font-size: 1.15rem;
  line-height: 1.5;
}

.release-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: auto;
  padding: 10px 12px;
  border: 1px solid rgba(var(--color-blue-rgb), 0.5);
  border-radius: 7px;
  background: rgba(var(--color-blue-rgb), 0.9);
  color: white;
  font-size: 1.15rem;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
  transition: background 0.15s;

  &:hover {
    background: rgba(var(--color-blue-rgb), 1);
  }

  svg {
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
  }
}
</style>
