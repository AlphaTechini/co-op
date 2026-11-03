<div class="pool-layout" aria-busy="true" aria-label="Loading pool">
  <section class="pool-layout__ladder card">
    <div class="card__body" style="display:grid;gap:var(--space-5)">
      <span class="skeleton" style="inline-size:40%"></span>
      <span class="skeleton skeleton--num" style="block-size:64px;inline-size:160px"></span>
      <span class="skeleton" style="inline-size:92%"></span>
      <span class="skeleton" style="inline-size:70%"></span>
      {#each [0, 1, 2] as i (i)}<span class="skeleton" style="block-size:88px;border-radius:8px;opacity:{1 - i * 0.2}"></span>{/each}
    </div>
  </section>
  <section class="pool-layout__facts card">
    <div class="pool-facts">
      {#each [0, 1, 2, 3] as i (i)}
        <div class="stat"><span class="skeleton" style="inline-size:50%"></span><span class="skeleton skeleton--num"></span><span class="skeleton" style="inline-size:60%"></span></div>
      {/each}
    </div>
  </section>
  <section class="pool-layout__members card">
    <div class="card__head"><span class="skeleton" style="inline-size:96px;block-size:14px"></span></div>
    <div class="card__body" style="display:grid;gap:var(--space-5)">
      {#each [0, 1, 2, 3, 4] as i (i)}
        <div style="display:grid;grid-template-columns:28px 1fr 96px;gap:var(--space-4);align-items:center"><span class="skeleton" style="block-size:28px"></span><span style="display:grid;gap:8px"><span class="skeleton" style="inline-size:{50 + i * 6}%"></span><span class="skeleton" style="inline-size:75%"></span></span><span class="skeleton" style="block-size:24px;border-radius:999px"></span></div>
      {/each}
    </div>
  </section>
  <aside class="pool-layout__feed card">
    <div class="card__head"><span class="skeleton" style="inline-size:64px;block-size:14px"></span></div>
    <div class="card__body" style="display:grid;gap:var(--space-5)">
      {#each [0, 1, 2] as i (i)}
        <div style="display:grid;grid-template-columns:24px 1fr;gap:var(--space-4)"><span class="skeleton skeleton--circle" style="block-size:24px"></span><span style="display:grid;gap:8px"><span class="skeleton"></span><span class="skeleton" style="inline-size:50%"></span></span></div>
      {/each}
    </div>
  </aside>
</div>
