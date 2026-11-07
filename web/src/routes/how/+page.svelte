<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { formatNear } from '#lib/format.ts';
  import { priceFor, resolve, type Entry } from '#lib/settlement.ts';

  // Worked example: an illustration with fixed inputs, run through the same resolve() the
  // dashboard uses for live pools. It is not live data and is labelled as an example.
  const tiers = [
    { min_units: 1, unit_price: '1000000000000000000000000' },
    { min_units: 20, unit_price: '700000000000000000000000' },
    { min_units: 50, unit_price: '500000000000000000000000' }
  ];
  const base: Entry[] = [
    ...[3, 2, 4, 3, 2, 4].map((units) => ({ units, threshold: null })),
    ...[3, 4, 2].map((units) => ({ units, threshold: 20 })),
    ...[5, 6, 4].map((units) => ({ units, threshold: 50 }))
  ];
  const total = (e: Entry[]) => e.reduce((a, x) => a + x.units, 0);

  function trace(entries: Entry[]) {
    const all = total(entries);
    const r = resolve(entries);
    const dropped = entries.filter((_, i) => !r.included[i]);
    const highest = Math.max(...entries.map((e) => e.threshold ?? 0));
    const remaining = Math.max(...entries.filter((_, i) => r.included[i]).map((e) => e.threshold ?? 0));
    const tier = priceFor(tiers, r.units);
    return { all, r, dropped, highest, remaining, price: tier ? formatNear(tier.price) : 'None', count: entries.length };
  }
  const a = trace(base);
  const more = [...base, { units: 8, threshold: null } as Entry];
  const b = trace(more);
  const pulledIn = b.r.included.slice(0, base.length).filter((x, i) => x && !a.r.included[i]);
  const pulledUnits = more.filter((_, i) => b.r.included[i] && !a.r.included[i] && i < base.length).reduce((s, e) => s + e.units, 0);
  const pulledCount = pulledIn.length;
</script>

<svelte:head><title>How it works · Co-op</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container">
    <header class="how-intro" style="margin-block-end:var(--space-10)">
      <div>
        <p class="t-eyebrow" style="margin-block-end:var(--space-5)">How it works</p>
        <h1 class="t-display-l">One price for the group, and a ceiling for every agent.</h1>
      </div>
      <p class="t-body-l text-secondary" style="text-wrap:pretty">A seller posts an offer with price tiers. Buyer agents join a pool for that offer, outright or on a condition. At the deadline the contract finds the largest group whose conditions all hold, charges everyone the tier price that group reached, pays the seller, delivers the goods and refunds the rest. If no tier is reached, everyone is refunded in full.</p>
    </header>

    <section class="section diagram-pair" aria-label="Mechanism diagram">
      <figure class="diagram-panel">
        <div class="diagram-panel__head"><span class="t-eyebrow">Before the deadline</span><span class="t-body-s text-tertiary">Illustrative figures</span></div>
        <svg class="dg" viewBox="0 0 360 410" role="img" aria-labelledby="dg1-t">
          <title id="dg1-t">Before the deadline. The seller deposits 60 units into the Co-op contract. Three agents lock funds in the contract: eager-01 locks 3.00 NEAR for 3 units, bargain-01 locks 2.10 NEAR for 3 units if the group reaches 20, bargain-04 locks 2.50 NEAR for 5 units if the group reaches 50.</title>
          <rect class="dg-box" x="90" y="4" width="180" height="56" rx="8"/>
          <text x="180" y="28" text-anchor="middle" class="dg-strong">Seller</text>
          <text x="180" y="46" text-anchor="middle" class="dg-mono">seller.operator.testnet</text>
          <path class="dg-line" d="M180 62 V146"/><path class="dg-head" d="M175 142 L180 150 L185 142 Z"/>
          <text x="192" y="100" class="dg-label">deposits 60 units</text>
          <text x="192" y="116" class="dg-label">up front</text>

          <rect class="dg-box--ink" x="40" y="152" width="280" height="96" rx="12"/>
          <text x="180" y="184" text-anchor="middle" class="dg-on-ink dg-strong" style="font-size:15px">Co-op contract</text>
          <text x="180" y="204" text-anchor="middle" class="dg-on-ink-dim">holds the inventory and every lock</text>
          <text x="180" y="226" text-anchor="middle" class="dg-on-ink-dim">no owner · no admin key</text>

          <path class="dg-line dg-line--accent" d="M60 326 V252"/><path class="dg-head dg-head--accent" d="M55 256 L60 248 L65 256 Z"/>
          <text x="66" y="300" class="dg-label-accent">locks 3.00</text>
          <path class="dg-line dg-line--accent" d="M180 326 V252"/><path class="dg-head dg-head--accent" d="M175 256 L180 248 L185 256 Z"/>
          <text x="186" y="300" class="dg-label-accent">locks 2.10</text>
          <path class="dg-line dg-line--cond" d="M300 326 V252"/><path class="dg-head dg-head--cond" d="M295 256 L300 248 L305 256 Z"/>
          <text x="306" y="300" class="dg-label-cond">2.50</text>

          <rect class="dg-box--committed" x="4" y="330" width="112" height="60" rx="8"/>
          <text x="60" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px">eager-01</text>
          <text x="60" y="374" text-anchor="middle" class="dg-small">3 units, now</text>
          <rect class="dg-box--committed" x="124" y="330" width="112" height="60" rx="8"/>
          <text x="180" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px">bargain-01</text>
          <text x="180" y="374" text-anchor="middle" class="dg-small">3 units if ≥ 20</text>
          <rect class="dg-box--waiting" x="244" y="330" width="112" height="60" rx="8"/>
          <text x="300" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px">bargain-04</text>
          <text x="300" y="374" text-anchor="middle" class="dg-small">5 units if ≥ 50</text>
        </svg>
        <figcaption class="t-body-s text-tertiary">Each lock is units times the price at the agent's own threshold. That is the most it can ever pay.</figcaption>
      </figure>

      <figure class="diagram-panel">
        <div class="diagram-panel__head"><span class="t-eyebrow">At settlement</span><span class="t-body-s text-tertiary">Illustrative figures</span></div>
        <svg class="dg" viewBox="0 0 360 410" role="img" aria-labelledby="dg2-t">
          <title id="dg2-t">At settlement the group reached 20 units but not 50, so the price is 0.70. The contract pays the seller, sends eager-01 3 units and 0.90 NEAR back, sends bargain-01 3 units, and refunds bargain-04 in full because its condition did not hold.</title>
          <rect class="dg-box" x="90" y="4" width="180" height="56" rx="8"/>
          <text x="180" y="28" text-anchor="middle" class="dg-strong">Seller</text>
          <text x="180" y="46" text-anchor="middle" class="dg-mono">seller.operator.testnet</text>
          <path class="dg-line dg-line--accent" d="M180 150 V66"/><path class="dg-head dg-head--accent" d="M175 70 L180 62 L185 70 Z"/>
          <text x="192" y="100" class="dg-label-accent">units × 0.70</text>
          <text x="192" y="116" class="dg-label">+ unsold units back</text>

          <rect class="dg-box--ink" x="40" y="152" width="280" height="96" rx="12"/>
          <text x="180" y="184" text-anchor="middle" class="dg-on-ink dg-strong" style="font-size:15px">Group resolved: 0.70</text>
          <text x="180" y="204" text-anchor="middle" class="dg-on-ink-dim">largest group whose conditions hold</text>
          <text x="180" y="226" text-anchor="middle" class="dg-on-ink-dim">one price for every member</text>

          <path class="dg-line dg-line--accent" d="M60 252 V322"/><path class="dg-head dg-head--accent" d="M55 318 L60 326 L65 318 Z"/>
          <text x="66" y="284" class="dg-label-accent">3 units</text>
          <text x="66" y="300" class="dg-label">0.90 back</text>
          <path class="dg-line dg-line--accent" d="M180 252 V322"/><path class="dg-head dg-head--accent" d="M175 318 L180 326 L185 318 Z"/>
          <text x="186" y="284" class="dg-label-accent">3 units</text>
          <text x="186" y="300" class="dg-label">0.00 back</text>
          <path class="dg-line dg-line--muted" d="M300 252 V322"/><path class="dg-head dg-head--muted" d="M295 318 L300 326 L305 318 Z"/>
          <text x="306" y="284" class="dg-label">2.50</text>
          <text x="306" y="300" class="dg-label">back</text>

          <rect class="dg-box--committed" x="4" y="330" width="112" height="60" rx="8"/>
          <text x="60" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px">eager-01</text>
          <text x="60" y="374" text-anchor="middle" class="dg-small">paid 2.10</text>
          <rect class="dg-box--committed" x="124" y="330" width="112" height="60" rx="8"/>
          <text x="180" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px">bargain-01</text>
          <text x="180" y="374" text-anchor="middle" class="dg-small">paid 2.10</text>
          <rect class="dg-box--excluded" x="244" y="330" width="112" height="60" rx="8"/>
          <text x="300" y="355" text-anchor="middle" class="dg-strong" style="font-family:var(--font-mono);font-size:12px;fill:var(--text-tertiary)">bargain-04</text>
          <text x="300" y="374" text-anchor="middle" class="dg-small">excluded, paid 0</text>
        </svg>
        <figcaption class="t-body-s text-tertiary">The group reached 20 but not 50, so bargain-04 is out and gets every coin back. Nobody paid above its limit.</figcaption>
      </figure>
    </section>

    <section class="section" aria-labelledby="steps-title">
      <div class="section-head"><h2 id="steps-title" class="t-display-m">Five steps</h2></div>
      <ol class="steps">
        <li class="step"><span class="step__n">01</span><h3 class="step__title">A seller posts tiers</h3><div class="step__body"><p>The seller lists an item with price tiers, for example 1.00 per unit from 1 unit, 0.70 from 20, 0.50 from 50, and deposits all of the inventory into the contract up front. Delivery can never fail for lack of stock.</p></div></li>
        <li class="step"><span class="step__n">02</span><h3 class="step__title">Owners fund agents with limits</h3><div class="step__body"><p>Each agent is a sub-account of its owner with a budget and a maximum price per unit, both held by the contract. Its key can call <span class="code">join_pool</span> and <span class="code">leave_pool</span> and nothing else.</p></div></li>
        <li class="step"><span class="step__n">03</span><h3 class="step__title">Agents join, outright or on a condition</h3><div class="step__body"><p>&ldquo;I&rsquo;ll take 3.&rdquo; Or &ldquo;I&rsquo;ll take 3 if the group reaches 50.&rdquo; The contract locks units times the price at that threshold. Agents can leave until the lock time; after that the group is frozen.</p></div></li>
        <li class="step"><span class="step__n">04</span><h3 class="step__title">The contract resolves the group</h3><div class="step__body"><p>After the deadline anyone can call <span class="code">settle</span>. It starts with every member and removes the highest unmet threshold until all remaining conditions hold. Then it picks the best tier that group reaches.</p></div></li>
        <li class="step"><span class="step__n">05</span><h3 class="step__title">Everyone settles at one price</h3><div class="step__body"><p>Each member pays the tier price, receives its units and gets the rest of its lock back. The seller is paid and its unsold units return. If no tier is reached, every agent is refunded in full and the seller keeps its inventory.</p></div></li>
      </ol>
    </section>

    <section class="section" aria-labelledby="worked-title">
      <div class="section-head"><h2 id="worked-title" class="t-display-m">Worked example</h2><span class="t-body-s text-tertiary">An example pool with tiers at 20 and 50 units, not live data</span></div>
      <div class="worked">
        <div class="card">
          <div class="card__head"><h3 class="card__title">{a.all} units pledged</h3><span class="mono t-body-s">result {a.price}</span></div>
          <ol class="card__body resolve">
            <li><span class="resolve__n">1</span><span>Start with all {a.count} members</span><span class="resolve__v">{a.all}</span></li>
            <li><span class="resolve__n">2</span><span>Highest threshold is {a.highest}, above {a.all}. Remove those {a.dropped.length} agents</span><span class="resolve__v">{a.r.units}</span></li>
            <li><span class="resolve__n">3</span><span>Highest remaining threshold is {a.remaining}, met by {a.r.units}. Stop</span><span class="resolve__v">{a.r.units}</span></li>
            <li><span class="resolve__n">4</span><span>Best tier for {a.r.units} units</span><span class="resolve__v text-accent">{a.price}</span></li>
          </ol>
        </div>
        <div class="card">
          <div class="card__head"><h3 class="card__title">8 more units arrive</h3><span class="mono t-body-s">result {b.price}</span></div>
          <ol class="card__body resolve">
            <li><span class="resolve__n">1</span><span>Start with every member</span><span class="resolve__v">{b.all}</span></li>
            <li><span class="resolve__n">2</span><span>Highest threshold is {b.highest}, met by {b.all}. Stop</span><span class="resolve__v">{b.r.units}</span></li>
            <li><span class="resolve__n">3</span><span>The {pulledCount} waiting agents are now in</span><span class="resolve__v">+{pulledUnits}</span></li>
            <li><span class="resolve__n">4</span><span>Best tier for {b.r.units} units</span><span class="resolve__v text-accent">{b.price}</span></li>
          </ol>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="security-title">
      <div class="section-head"><h2 id="security-title" class="t-display-m">Security model</h2></div>
      <div class="trio">
        <div class="trio__item">
          <span class="trio__icon"><Icon name="fork" size="lg" /></span>
          <h3 class="t-title-m">Sub-accounts</h3>
          <p class="text-secondary">Every agent is <span class="code">name.owner.testnet</span>. Deliveries and refunds land on that account and trace back to its owner. Only the parent account can register it or withdraw its budget.</p>
        </div>
        <div class="trio__item">
          <span class="trio__icon"><Icon name="key" size="lg" /></span>
          <h3 class="t-title-m">Function-call keys</h3>
          <p class="text-secondary">The agent runtime holds a key limited to <span class="code">join_pool</span> and <span class="code">leave_pool</span> on the Co-op contract. It cannot attach a deposit, move NEAR or call anything else. Owner methods require 1 yoctoNEAR, which this key cannot send.</p>
        </div>
        <div class="trio__item">
          <span class="trio__icon"><Icon name="shield" size="lg" /></span>
          <h3 class="t-title-m">Contract escrow</h3>
          <p class="text-secondary">Budgets, locks, inventory and payouts live in one contract with no owner and no admin. After the final deploy its full-access keys are removed, so nobody can swap the code.</p>
        </div>
      </div>
    </section>

    <section class="section" id="not-built" aria-labelledby="honest-title">
      <div class="section-head"><h2 id="honest-title" class="t-display-m">What is mocked or not built</h2></div>
      <ul class="honesty">
        <li><Icon name="store" /><span><b>The seller is ours.</b> The demo seller and its voucher token were deployed by us. The token is labeled a demo voucher and has no value.</span></li>
        <li><Icon name="alert" /><span><b>Testnet only.</b> No real money and no mainnet deploy.</span></li>
        <li><Icon name="cpu" /><span><b>The LLM is optional and off by default.</b> Briefs are read by a rules parser, and the interface always says which one ran.</span></li>
        <li><Icon name="users" /><span><b>12 agents in the testnet evidence run.</b> The recorded run used 12 scripted agents with mixed budgets. Agents you spawn join the same pools for real.</span></li>
        <li><Icon name="x" /><span><b>Not built yet.</b> Seller price improvements, the Switcher agent and gasless signed joins.</span></li>
      </ul>
    </section>
  </div>
</main>
