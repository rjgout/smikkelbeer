<script lang="ts">
  import { onMount } from 'svelte';
  import { api, money, time, date } from '#lib/client';
  type Line = { productId: string; optionIds: string[]; quantity: number; note: string };
  let data: any = $state(null),
    message = $state(''),
    failure = $state(false),
    loading = $state(true),
    busy = $state(false),
    email = $state(''),
    view = $state('menu'),
    category = $state('Patat'),
    search = $state(''),
    cart: Line[] = $state([]),
    revision = $state(0),
    selected: any = $state(null),
    selectedOptions: string[] = $state([]),
    note = $state(''),
    quantity = $state(1),
    newEmail = $state('');
  async function load() {
    try {
      data = await api('employee');
      cart = data.order
        ? JSON.parse(data.order.lines).map((l: any) => ({
            productId: l.productId,
            optionIds: l.optionIds,
            quantity: l.quantity,
            note: l.note,
          }))
        : [];
      revision = data.order?.revision || 0;
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('Log in')) {
        message = String(e instanceof Error ? e.message : e);
        failure = true;
      }
    }
    loading = false;
  }
  onMount(load);
  const products = $derived(data?.round?.products || []);
  const filtered = $derived(
    products.filter(
      (p: any) =>
        p.category === category && p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
  );
  const favorites = $derived(products.filter((p: any) => data?.favorites.includes(p.id)));
  const count = $derived(cart.reduce((n, l) => n + l.quantity, 0));
  function unit(l: Line) {
    const p = products.find((p: any) => p.id === l.productId);
    return p
      ? p.cents +
          p.options
            .filter((o: any) => l.optionIds.includes(o.id))
            .reduce((n: number, o: any) => n + o.cents, 0)
      : 0;
  }
  const total = $derived(cart.reduce((n, l) => n + unit(l) * l.quantity, 0));
  async function action(fn: () => Promise<void>) {
    busy = true;
    message = '';
    failure = false;
    try {
      await fn();
    } catch (e) {
      failure = true;
      message = e instanceof Error ? e.message : 'Er ging iets mis';
    } finally {
      busy = false;
    }
  }
  function openDialog(node: HTMLDialogElement) {
    node.showModal();
  }
  function choose(p: any) {
    selected = p;
    selectedOptions = [];
    note = '';
    quantity = 1;
  }
  function add() {
    const key = JSON.stringify([selected.id, [...selectedOptions].sort(), note.trim()]);
    const existing = cart.find(
      (l) => JSON.stringify([l.productId, [...l.optionIds].sort(), l.note]) === key,
    );
    if (existing) existing.quantity = Math.min(30, existing.quantity + quantity);
    else
      cart.push({
        productId: selected.id,
        optionIds: [...selectedOptions],
        quantity,
        note: note.trim(),
      });
    selected = null;
    message = 'Toegevoegd aan je bestelling';
    failure = false;
  }
  async function favorite(p: any) {
    await action(async () => {
      const favorite = !data.favorites.includes(p.id);
      await api('favorite', { productId: p.id, favorite });
      data.favorites = favorite
        ? [...data.favorites, p.id]
        : data.favorites.filter((id: string) => id !== p.id);
    });
  }
  async function submit(declined = false) {
    await action(async () => {
      const r = await api('order', { roundId: data.round.id, revision, lines: cart, declined });
      revision = r.revision;
      if (declined) cart = [];
      message = declined
        ? 'Opgeslagen: deze keer geen snacks.'
        : 'Je bestelling is bevestigd. Eet alvast smakelijk!';
      await load();
    });
  }
</script>

<header class="site-header">
  <a class="brand" href="/"
    ><span class="brand-icon">ʕ•ᴥ•ʔ</span> smikkelbeer<span class="brand-dot">.</span></a
  ><span class="header-caption">Samen bestellen. Lekker geregeld.</span>{#if data}<button
      class="avatar"
      onclick={() => (view = view === 'profile' ? 'menu' : 'profile')}
      aria-label="Mijn profiel openen">{data.profile.name.slice(0, 1)}</button
    >{/if}
</header>
{#if loading}<main class="login-card">
    <div class="eyebrow">Even geduld</div>
    <h1>We zetten alles klaar.</h1>
  </main>
{:else if !data}<main class="welcome">
    <div class="welcome-art" aria-hidden="true">
      <span>ʕ•ᴥ•ʔ</span>
      <div class="snack-float">🍟</div>
      <div class="art-caption">Een kleine pauze.<br />Een groot plezier.</div>
    </div>
    <section class="welcome-content">
      <div class="eyebrow">Voor Team Informatie & Automatisering</div>
      <h1>Goed werk verdient<br />iets <em>lekkers.</em></h1>
      <p class="lead">
        Jouw favorieten van Cafetaria ’t Centrum in Marum. Samen besteld, zonder gedoe.
      </p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          action(async () => {
            const r = await api('link/request', { email });
            message = r.message;
          });
        }}
      >
        <label for="email">Je e-mailadres</label><input
          id="email"
          type="email"
          autocomplete="email"
          bind:value={email}
          required
          placeholder="jij@voorbeeld.nl"
        /><button class="primary full" disabled={busy}
          >Stuur mij een inloglink <span>↗</span></button
        >
      </form>
      <p class="muted small">
        Alleen voor uitgenodigde medewerkers. Je hebt geen wachtwoord nodig.
      </p>
      {#if message}<div class:danger={failure} class="notice" role="status">{message}</div>{/if}<a
        class="subtle-link"
        href="/admin">Naar de beheerdersomgeving →</a
      >
    </section>
  </main>
{:else}<main class="employee-main">
    <nav class="employee-nav">
      <button class:active={view === 'menu'} onclick={() => (view = 'menu')}>Menukaart</button
      ><button class:active={view === 'history'} onclick={() => (view = 'history')}
        >Mijn bestellingen</button
      ><button class:active={view === 'profile'} onclick={() => (view = 'profile')}
        >Mijn profiel</button
      >
    </nav>
    {#if message}<div class:danger={failure} class="notice" role="status">{message}</div>{/if}
    {#if view === 'menu'}<section class="greeting">
        <div>
          <div class="eyebrow">De lekkerste pauze van je dag</div>
          <h1>Hoi {data.profile.name},<br />waar heb je trek in<span class="coral">?</span></h1>
          <p>Vers van ’t Centrum. Met liefde voor het team.</p>
        </div>
        <div class="round-badge">
          {#if data.round}<span class="live-dot"></span> Bestellen tot
            <strong>{time(data.round.closes)}</strong><small
              >Aankomst rond {time(data.round.arrives)}</small
            >{:else}<strong>Even geen open ronde</strong><small
              >Je krijgt een uitnodiging zodra we starten.</small
            >{/if}
        </div>
      </section>
      {#if data.round}<div class="order-layout">
          <div class="menu-column">
            <section class="favorites">
              <div class="section-heading">
                <h2>★ Mijn favorieten</h2>
                <span class="muted small">Jouw vaste prik</span>
              </div>
              {#if !favorites.length}<p class="muted">
                  Tik op een ster bij een product. Je favorieten staan hier de volgende keer weer.
                </p>{:else}<div class="favorite-grid">
                  {#each favorites as p}<article class="favorite-card">
                      <button
                        class="star marked"
                        aria-label={'Verwijder ' + p.name + ' uit favorieten'}
                        onclick={() => favorite(p)}>★</button
                      ><span class="food-emoji" aria-hidden="true"
                        >{p.category === 'Patat'
                          ? '🍟'
                          : p.category === 'Snacks'
                            ? '🥟'
                            : '🍴'}</span
                      >
                      <h3>{p.name}</h3>
                      <div class="row">
                        <strong>{money(p.cents)}</strong><button
                          class="plus"
                          disabled={!p.available}
                          aria-label={p.name + ' toevoegen'}
                          onclick={() => choose(p)}>+</button
                        >
                      </div>
                    </article>{/each}
                </div>{/if}
            </section>
            <div class="category-tabs" role="tablist" aria-label="Menucategorie">
              {#each ['Patat', 'Snacks', 'Overige'] as c}<button
                  role="tab"
                  aria-selected={category === c}
                  class:active={category === c}
                  onclick={() => {
                    category = c;
                    search = '';
                  }}>{c === 'Patat' ? '🍟' : c === 'Snacks' ? '🥟' : '🍴'} {c}</button
                >{/each}
            </div>
            <label class="search-label" for="search">Zoeken in {category}</label><input
              class="search"
              id="search"
              type="search"
              placeholder={'Zoek iets lekkers in ' + category.toLowerCase() + '…'}
              bind:value={search}
            />
            <div class="section-heading">
              <h2>{category}</h2>
              <span class="muted small">{filtered.length} producten</span>
            </div>
            <div class="products">
              {#each filtered as p}<article class="product-row">
                  <button
                    class="star"
                    class:marked={data.favorites.includes(p.id)}
                    aria-label={(data.favorites.includes(p.id) ? 'Verwijder ' : 'Bewaar ') +
                      p.name +
                      ' als favoriet'}
                    onclick={() => favorite(p)}>{data.favorites.includes(p.id) ? '★' : '☆'}</button
                  >
                  <div class="product-info">
                    <h3>{p.name}</h3>
                    <p>
                      {p.available
                        ? p.options.length
                          ? 'Met keuze uit sauzen en extra’s'
                          : 'Vers bereid door ’t Centrum'
                        : 'Tijdelijk niet beschikbaar'}
                    </p>
                  </div>
                  <strong>{money(p.cents)}</strong><button
                    class="plus"
                    disabled={!p.available}
                    aria-label={p.name + ' toevoegen'}
                    onclick={() => choose(p)}>+</button
                  >
                </article>{/each}{#if !filtered.length}<p class="empty">
                  Niets gevonden in deze categorie.
                </p>{/if}
            </div>
            <p class="source-note">
              Prijzen en opties komen uitsluitend van hetcentrummarum.nl.<br />Laatste broncontrole: {data.lastSync
                ? date(data.lastSync.at)
                : 'onbekend'}.
            </p>
          </div>
          <aside class="basket">
            <div class="section-heading">
              <h2>Jouw bestelling</h2>
              <span class="count">{count}</span>
            </div>
            <p class="muted small">Een momentje voor jezelf.</p>
            {#if !cart.length}<div class="empty-cart">
                <span aria-hidden="true">♧</span>
                <p>Nog even kiezen…</p>
                <small>Voeg je favorieten toe aan je mandje.</small>
              </div>{:else}{#each cart as l, i}<div class="cart-item">
                  <div class="row">
                    <strong>{products.find((p: any) => p.id === l.productId)?.name}</strong><button
                      class="icon-button"
                      aria-label="Product verwijderen"
                      onclick={() => cart.splice(i, 1)}>×</button
                    >
                  </div>
                  <small
                    >{products
                      .find((p: any) => p.id === l.productId)
                      ?.options.filter((o: any) => l.optionIds.includes(o.id))
                      .map((o: any) => o.name)
                      .join(', ')}
                    {l.note}</small
                  >
                  <div class="row">
                    <div class="stepper">
                      <button
                        aria-label="Minder"
                        onclick={() => (l.quantity > 1 ? l.quantity-- : cart.splice(i, 1))}
                        >−</button
                      ><span>{l.quantity}</span><button
                        aria-label="Meer"
                        disabled={l.quantity >= 30}
                        onclick={() => l.quantity++}>+</button
                      >
                    </div>
                    <strong>{money(unit(l) * l.quantity)}</strong>
                  </div>
                </div>{/each}{/if}
            <div class="basket-total row"><span>Totaal</span><strong>{money(total)}</strong></div>
            <button class="primary full" disabled={busy || !cart.length} onclick={() => submit()}
              >Bestelling {revision ? 'bijwerken' : 'bevestigen'} →</button
            >
            <p class="muted small center">Je kunt wijzigen tot {time(data.round.closes)}.</p>
            <button class="text-button full" disabled={busy} onclick={() => submit(true)}
              >Deze keer geen snacks</button
            >{#if data.order}<div class="saved-note">
                ✓ {data.order.declined ? 'Je doet niet mee' : 'Bestelling opgeslagen'}
              </div>{/if}
          </aside>
        </div>{:else}<div class="panel empty">
          <h2>Tot de volgende smikkelronde</h2>
          <p>Bekijk je eerdere bestellingen of pas je deelname aan in je profiel.</p>
        </div>{/if}
    {:else if view === 'profile'}<section class="profile-panel panel">
        <div class="eyebrow">Helemaal van jou</div>
        <h1>Mijn profiel</h1>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await api('profile', {
                name: data.profile.name,
                preferences: data.profile.preferences,
              });
              message = 'Je profiel is opgeslagen.';
            });
          }}
        >
          <label
            >Voornaam<input
              bind:value={data.profile.name}
              required
              maxlength="50"
              autocomplete="given-name"
            /></label
          >
          <p class="muted small">Eén unieke voornaam, zonder spaties. Bijvoorbeeld Henk-Jan.</p>
          <label
            >Deelname<select bind:value={data.profile.preferences.participation}
              ><option value="normal">Normaal meedoen</option><option value="away"
                >Tijdelijk afwezig</option
              ><option value="paused">Uitnodigingen pauzeren</option></select
            ></label
          >{#if data.profile.preferences.participation === 'away'}<div class="form-grid">
              <label
                >Van<input type="date" bind:value={data.profile.preferences.from} required /></label
              ><label
                >Tot en met<input
                  type="date"
                  bind:value={data.profile.preferences.until}
                  required
                /></label
              >
            </div>{/if}{#if data.round}<label class="check"
              ><input
                type="checkbox"
                checked={data.profile.preferences.skipRound === data.round.id}
                onchange={(e) =>
                  (data.profile.preferences.skipRound = e.currentTarget.checked
                    ? data.round.id
                    : '')}
              /> Deze ronde geen uitnodigingen meer</label
            >{/if}<label class="check"
            ><input type="checkbox" bind:checked={data.profile.preferences.confirmations} /> Stuur mij
            bestelbevestigingen per e-mail</label
          ><button class="primary" disabled={busy}>Profiel opslaan</button>
        </form>
        <hr />
        <h2>E-mailadres wijzigen</h2>
        <p class="muted">Huidig adres: {data.profile.email}</p>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await api('profile/email', { email: newEmail });
              message = 'Bevestig de link in je nieuwe mailbox vanuit deze browser.';
            });
          }}
        >
          <label>Nieuw e-mailadres<input type="email" required bind:value={newEmail} /></label
          ><button class="secondary" disabled={busy}>Verificatielink versturen</button>
        </form>
        <hr />
        <button
          class="text-button"
          onclick={() =>
            action(async () => {
              await api('logout', { kind: 'employee' });
              data = null;
            })}>Uitloggen</button
        >
      </section>
    {:else}<section>
        <div class="eyebrow">Jouw smikkelmomenten</div>
        <h1>Mijn bestellingen</h1>
        {#each data.history as o}<article class="panel history-card">
            <div class="row">
              <div>
                <h2>{o.day}</h2>
                <small>{o.number}</small>
              </div>
              <strong>{money(o.total)}</strong>
            </div>
            {#if o.declined}<p>Deze keer geen snacks</p>{:else}{#each JSON.parse(o.lines) as l}<p>
                  {l.quantity} × {l.name}
                  {l.options.join(', ')} <small>{l.note}</small>
                </p>{/each}
              <p class="muted small">
                {o.payment_mode === 'individual'
                  ? 'Individueel betalen bij de cafetaria'
                  : o.paid
                    ? 'Handmatig gemarkeerd als betaald'
                    : 'Terugbetaling openstaand · geen bankverificatie'}
              </p>
              {#if o.payment_link}<a
                  class="secondary"
                  href={o.payment_link}
                  target="_blank"
                  rel="noreferrer">Open betaalverzoek ↗</a
                >{/if}{/if}
          </article>{/each}{#if !data.history.length}<div class="panel empty">
            Je hebt nog geen bestellingen.
          </div>{/if}
      </section>{/if}
  </main>{/if}
<footer class="site-footer">
  <span>Smikkelbeer · Team I&A</span><span
    >Met elkaar. Voor elkaar. En een beetje voor de snacks.</span
  >
</footer>
{#if selected}<div class="modal-backdrop">
    <dialog
      use:openDialog
      onclose={() => (selected = null)}
      oncancel={() => (selected = null)}
      class="modal"
      aria-modal="true"
      aria-label={'Kies ' + selected.name}
      tabindex="-1"
    >
      <div class="row">
        <div>
          <div class="eyebrow">Maak ’m helemaal van jou</div>
          <h2>{selected.name}</h2>
        </div>
        <button class="icon-button" onclick={() => (selected = null)} aria-label="Sluiten">×</button
        >
      </div>
      <p>Basisprijs {money(selected.cents)}</p>
      {#if selected.options.length}<h3>Sauzen & extra’s</h3>
        {#each selected.options as o}<label class="option-label"
            ><input type="checkbox" value={o.id} bind:group={selectedOptions} /><span>{o.name}</span
            ><strong>+ {money(o.cents)}</strong></label
          >{/each}{/if}<label
        >Opmerking<input
          maxlength="200"
          bind:value={note}
          placeholder="Bijvoorbeeld: graag apart verpakken"
        /></label
      ><label>Aantal<input type="number" min="1" max="30" bind:value={quantity} /></label><button
        class="primary full"
        disabled={!quantity || quantity < 1 || quantity > 30}
        onclick={add}
        >Toevoegen · {money(
          (selected.cents +
            selected.options
              .filter((o: any) => selectedOptions.includes(o.id))
              .reduce((n: number, o: any) => n + o.cents, 0)) *
            quantity,
        )}</button
      >
    </dialog>
  </div>{/if}
