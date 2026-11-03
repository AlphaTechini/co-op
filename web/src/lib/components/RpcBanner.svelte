<script lang="ts">
  import { config } from '#lib/config.svelte.ts';
  import { fmtClock } from '#lib/format.ts';
  import { rpcState } from '#lib/rpc.svelte.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import { retryAll } from '#lib/stores/registry.ts';
  import Icon from './Icon.svelte';

  const show = $derived(rpcState.failures >= 2);
  const secs = $derived(rpcState.retryAt ? Math.max(0, Math.ceil((rpcState.retryAt - clock.now) / 1000)) : null);
  const urls = $derived(config.rpcUrls);
</script>

{#if show}
  <div class="rpc-banner" role="alert">
    <div class="container rpc-banner__inner">
      <Icon name="wifi-off" />
      <p class="rpc-banner__text">
        Can't reach {config.network} RPC.
        <span>
          {#if rpcState.lastOkAt}Showing data from {fmtClock(rpcState.lastOkAt, true)} UTC.{/if}
          {#if secs !== null}Retrying in {secs}s{/if}{#if urls.length > 1} across {urls.length} endpoints{:else if rpcState.host} with {rpcState.host}{/if}.
        </span>
      </p>
      <button class="btn btn--secondary btn--sm" type="button" onclick={retryAll}><Icon name="refresh" size="sm" />Retry now</button>
    </div>
  </div>
{/if}
