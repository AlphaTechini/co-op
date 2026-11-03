<script lang="ts">
  import { config } from '#lib/config.svelte.ts';

  let { id }: { id: string } = $props();
</script>

{#if config.hasExplorer}
  <a class="account-link" href={config.accountUrl(id)} target="_blank" rel="noopener" aria-label="Account {id} on {config.explorerName}, opens in a new tab">{id}</a>
{:else}
  <span class="account-link" title={id}>{id}</span>
{/if}
