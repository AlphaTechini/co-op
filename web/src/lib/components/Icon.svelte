<script lang="ts">
  let { name, size, class: cls = '' }: { name: string; size?: 'xs' | 'sm' | 'lg'; class?: string } = $props();
</script>

<svg class="icon {size ? `icon--${size}` : ''} {cls}" aria-hidden="true"><use href="#i-{name}" /></svg>
