<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    kind,
    icon,
    title,
    role = 'status',
    children,
    actions
  }: { kind: 'warning' | 'info' | 'negative' | 'positive'; icon: string; title: string; role?: 'status' | 'alert'; children?: Snippet; actions?: Snippet } = $props();
</script>

<div class="banner banner--{kind}" {role}>
  <Icon name={icon} />
  <div>
    <p class="banner__title">{title}</p>
    {#if children}<p class="banner__body">{@render children()}</p>{/if}
  </div>
  {#if actions}<div class="banner__actions">{@render actions()}</div>{:else}<span></span>{/if}
</div>
