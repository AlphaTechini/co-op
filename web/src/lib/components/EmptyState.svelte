<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, body, children }: { title: string; body?: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <svg class="empty__art" width="56" height="40" viewBox="0 0 56 40" aria-hidden="true"><rect x="1" y="2" width="54" height="8" rx="2" fill="none" stroke="currentColor" stroke-dasharray="3 3" /><rect x="9" y="16" width="46" height="8" rx="2" fill="none" stroke="currentColor" stroke-dasharray="3 3" /><rect x="17" y="30" width="38" height="8" rx="2" fill="none" stroke="currentColor" stroke-dasharray="3 3" /></svg>
  <p class="empty__title">{title}</p>
  {#if body}<p class="empty__body">{body}</p>{/if}
  {@render children?.()}
</div>
