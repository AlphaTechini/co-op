<script lang="ts">
  import { config } from '#lib/config.svelte.ts';
  import { shortHash } from '#lib/format.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import Icon from './Icon.svelte';

  let { hash, method, explorerUrl }: { hash: string; method?: string; explorerUrl?: string } = $props();
  const short = $derived(shortHash(hash));
  const linked = $derived(config.hasExplorer || !!explorerUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      toasts.push('positive', 'Hash copied', short);
    } catch {
      /* clipboard can be blocked; the full hash stays in the title */
    }
  }
</script>

{#if linked}
  <a
    class="tx"
    href={config.txUrl(hash, explorerUrl)}
    target="_blank"
    rel="noopener"
    title={hash}
    aria-label="Transaction {short} on {config.explorerName}, opens in a new tab"
  >{#if method}<span class="tx__method">{method}</span>{/if}{short}<Icon name="arrow-up-right" /></a>
{:else}
  <button class="tx" type="button" title="{hash} (no explorer on {config.network}; click to copy)" aria-label="Copy transaction hash {short}" onclick={copy}
  >{#if method}<span class="tx__method">{method}</span>{/if}{short}<Icon name="copy" /></button>
{/if}
