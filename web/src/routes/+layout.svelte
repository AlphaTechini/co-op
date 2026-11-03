<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import '#lib/styles/tokens.css';
  import '#lib/styles/components.css';
  import RpcBanner from '#lib/components/RpcBanner.svelte';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import SiteHeader from '#lib/components/SiteHeader.svelte';
  import Sprite from '#lib/components/Sprite.svelte';
  import Toasts from '#lib/components/Toasts.svelte';
  import { config } from '#lib/config.svelte.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import { theme } from '#lib/stores/theme.svelte.ts';

  let { children } = $props();

  onMount(() => {
    theme.init();
    clock.start();
    void config.load();
  });
</script>

<Sprite />
<div class:is-wide={page.url.pathname.startsWith('/pool')}>
  <SiteHeader />
  <RpcBanner />
  {@render children()}
  <SiteFooter />
</div>
<Toasts />
