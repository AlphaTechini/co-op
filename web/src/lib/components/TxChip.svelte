<script lang="ts">
  import { config } from '#lib/config.svelte.ts';
  import { shortHash } from '#lib/format.ts';
  import Icon from './Icon.svelte';

  let { hash, method, explorerUrl }: { hash: string; method?: string; explorerUrl?: string } = $props();
  const short = $derived(shortHash(hash));
</script>

<a
  class="tx"
  href={config.txUrl(hash, explorerUrl)}
  target="_blank"
  rel="noopener"
  aria-label="Transaction {short} on NearBlocks, opens in a new tab"
>{#if method}<span class="tx__method">{method}</span>{/if}{short}<Icon name="arrow-up-right" /></a>
