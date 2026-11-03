<script lang="ts">
  import { config, REPO_URL } from '#lib/config.svelte.ts';
</script>

<footer class="site-footer">
  <div class="container site-footer__inner">
    <p>Co-op runs on {config.network === 'sandbox' ? 'a local NEAR sandbox' : `NEAR ${config.network}`} only. The demo seller and its voucher token are ours and have no value.</p>
    <div class="site-footer__links">
      {#if config.contractId && config.hasExplorer}<a href={config.accountUrl(config.contractId)} target="_blank" rel="noopener">Contract on {config.explorerName}</a>{/if}
      <a href={REPO_URL} target="_blank" rel="noopener">Source</a>
      <a href="/how#not-built">What is not built</a>
    </div>
  </div>
</footer>
