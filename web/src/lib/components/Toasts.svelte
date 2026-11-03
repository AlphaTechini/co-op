<script lang="ts">
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import Icon from './Icon.svelte';
</script>

<div class="toast-region" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast toast--{t.kind}" role={t.kind === 'negative' ? 'alert' : 'status'}>
      <Icon name={t.kind === 'negative' ? 'alert' : 'check-circle'} class="toast__icon" />
      <div>
        <p class="toast__title">{t.title}</p>
        {#if t.body}<p class="toast__body">{t.body}</p>{/if}
      </div>
      <button class="icon-btn" type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}><Icon name="x" /></button>
    </div>
  {/each}
</div>
