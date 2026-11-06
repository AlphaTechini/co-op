<script lang="ts">
  import MyAgents from '#lib/components/MyAgents.svelte';
</script>

<svelte:head><title>My agents · Co-op</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container" style="max-inline-size:48rem">
    <header class="page-head">
      <h1 class="t-display-l">My agents</h1>
      <p class="t-body-l text-secondary">After a room settles, what your agents did not spend stays in the contract as their free budget. Withdraw it here; it goes straight to the wallet that owns them.</p>
    </header>
    <MyAgents />
  </div>
</main>
