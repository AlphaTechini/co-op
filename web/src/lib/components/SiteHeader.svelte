<script lang="ts">
  import { page } from '$app/state';
  import { config } from '#lib/config.svelte.ts';
  import { rpcState } from '#lib/rpc.svelte.ts';
  import { theme } from '#lib/stores/theme.svelte.ts';
  import { wallet } from '#lib/wallet.svelte.ts';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  onMount(() => void wallet.restore());

  const links = [
    { href: '/', label: 'Rooms', match: (p: string) => p === '/' || p.startsWith('/pool') || p.startsWith('/room') },
    { href: '/create', label: 'Open a room', match: (p: string) => p.startsWith('/create') },
    { href: '/spawn', label: 'Spawn agents', match: (p: string) => p.startsWith('/spawn') },
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
        {#if config.hasExplorer}
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
        {:else}
          <span class="net-chip" data-rpc={health} title={chipTitle} aria-label="{config.network} network, {chipTitle}">
            <span class="net-chip__dot" aria-hidden="true"></span><span class="net-chip__label">{config.network}</span>{#if config.contractId}<span class="net-chip__contract">{config.contractId}</span>{/if}
          </span>
        {/if}
        {#if wallet.accountId}
          <button class="btn btn--ghost btn--sm mono" type="button" title="Disconnect {wallet.accountId}" onclick={() => wallet.disconnect()}>{wallet.accountId.length > 22 ? `${wallet.accountId.slice(0, 20)}…` : wallet.accountId}</button>
        {:else if wallet.ready}
          <button class="btn btn--secondary btn--sm" type="button" onclick={() => wallet.connect()} disabled={wallet.busy}>Connect wallet</button>
        {/if}
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
