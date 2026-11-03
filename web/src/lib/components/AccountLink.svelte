<script lang="ts">
  import { config } from '#lib/config.svelte.ts';

  let { id }: { id: string } = $props();
</script>

<a class="account-link" href={config.accountUrl(id)} target="_blank" rel="noopener" aria-label="Account {id} on NearBlocks, opens in a new tab">{id}</a>
