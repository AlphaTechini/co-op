<script lang="ts">
  import { page } from '$app/state';
  import { config } from '#lib/config.svelte.ts';
  import { rpcState } from '#lib/rpc.svelte.ts';
  import { theme } from '#lib/stores/theme.svelte.ts';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  const links = [
    { href: '/', label: 'Pools', match: (p: string) => p === '/' || p.startsWith('/pool') },
    { href: '/spawn', label: 'Spawn an agent', match: (p: string) => p.startsWith('/spawn') },
    { href: '/how', label: 'How it works', match: (p: string) => p.startsWith('/how') }
  ];

  const health = $derived(rpcState.health);
  const host = $derived(rpcState.host || (config.rpcUrls[0] ?? '').replace(/^https?:\/\//, ''));
  const chipTitle = $derived(
    `RPC ${host} is ${health === 'ok' ? 'responding' : health === 'slow' ? 'slow' : 'unreachable'}`
  );
</script>

<header class="site-header">
  <div class="container">
    <div class="site-header__inner">
      <a class="brand" href="/" aria-label="Co-op, all pools">
        <Logo />
        <span class="brand__word">Co-op</span>
      </a>
      <nav class="nav" aria-label="Primary">
        {#each links as l (l.href)}
          <a class="nav__link" href={l.href} aria-current={l.match(page.url.pathname) ? 'page' : undefined}>{l.label}</a>
        {/each}
      </nav>
      <div class="site-header__end">
        <a
          class="net-chip"
          href={config.contractId ? config.accountUrl(config.contractId) : config.explorerAccountBase}
          target="_blank"
          rel="noopener"
          data-rpc={health}
          title={chipTitle}
          aria-label="{config.network} network, {chipTitle}"
        >
          <span class="net-chip__dot" aria-hidden="true"></span><span class="net-chip__label">{config.network}</span>{#if config.contractId}<span class="net-chip__contract">{config.contractId}</span>{/if}
        </a>
        <button class="icon-btn theme-toggle" type="button" aria-label="Switch theme" onclick={() => theme.toggle()}>
          <Icon name="sun" class="icon--sun" /><Icon name="moon" class="icon--moon" />
        </button>
      </div>
    </div>
    <nav class="nav-row" aria-label="Primary">
      {#each links as l (l.href)}
        <a class="nav__link" href={l.href} aria-current={l.match(page.url.pathname) ? 'page' : undefined}>{l.label}</a>
      {/each}
    </nav>
  </div>
</header>
