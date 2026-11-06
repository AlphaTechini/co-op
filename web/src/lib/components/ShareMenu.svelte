<script lang="ts">
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import Icon from './Icon.svelte';

  // Brand glyphs from Simple Icons 15.22.0 (CC0). Each target opens its own share page; nothing is sent from here.
  let { code, title, variant = 'secondary' }: { code: string; title: string; variant?: 'primary' | 'secondary' } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);

  const url = $derived(typeof location === 'undefined' ? `/room?code=${code}` : `${location.origin}/room?code=${code}`);
  const message = $derived(`Join my Co-op room for ${title}: send your agents in and we all get the bulk price. Room code ${code}.`);
  const enc = encodeURIComponent;

  const targets = $derived([
    {
      key: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${enc(url)}&text=${enc(message)}`,
      path: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'
    },
    {
      key: 'x',
      label: 'X',
      href: `https://x.com/intent/tweet?text=${enc(message)}&url=${enc(url)}`,
      path: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z'
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${enc(`${message} ${url}`)}`,
      path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'
    },
    {
      key: 'email',
      label: 'Email',
      href: `mailto:?subject=${enc(`Join my Co-op room (${code})`)}&body=${enc(`${message}\n\n${url}`)}`,
      path: null
    }
  ]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toasts.push('positive', 'Invite link copied');
    } catch {
      toasts.push('negative', 'Could not copy the link', url);
    }
    open = false;
  }

  function onWindowClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="share" bind:this={root}>
  <button class="btn btn--{variant}" type="button" aria-expanded={open} aria-controls="share-{code}" onclick={() => (open = !open)}>
    <Icon name="arrow-up-right" />Share code
  </button>
  {#if open}
    <div class="share__menu card" id="share-{code}">
      <p class="share__code t-body-s text-secondary">Room code <span class="mono">{code}</span></p>
      <div class="share__grid">
        {#each targets as t (t.key)}
          <a class="share__item" aria-label="Share on {t.label}" href={t.href} target={t.key === 'email' ? undefined : '_blank'} rel="noopener noreferrer" onclick={() => (open = false)}>
            <svg class="share__glyph" viewBox="0 0 24 24" aria-hidden="true">
              {#if t.path}
                <path d={t.path} fill="currentColor" />
              {:else}
                <rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path d="m3.5 6.5 8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              {/if}
            </svg>
            <span>{t.label}</span>
          </a>
        {/each}
        <button class="share__item" type="button" onclick={copy}>
          <Icon name="copy" size="lg" />
          <span>Copy link</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .share {
    position: relative;
    display: inline-block;
  }
  .share__menu {
    position: absolute;
    z-index: 20;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline-start: 0;
    inline-size: min(20rem, calc(100vw - 2rem));
    padding: var(--space-4);
    box-shadow: var(--shadow-2, 0 8px 24px rgb(0 0 0 / 0.25));
  }
  .share__code {
    margin-block-end: var(--space-3);
  }
  .share__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr));
    gap: var(--space-2);
  }
  .share__item {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: var(--space-3) var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-m);
    background: var(--bg-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-body-s);
    text-decoration: none;
    cursor: pointer;
  }
  .share__item:hover,
  .share__item:focus-visible {
    border-color: var(--border-strong);
    background: var(--elevated);
  }
  .share__glyph,
  .share__item :global(.icon) {
    inline-size: 22px;
    block-size: 22px;
  }
</style>
