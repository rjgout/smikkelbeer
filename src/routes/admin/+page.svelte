<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, money, time, date, statusLabel, calendarDate } from '#lib/client';
  let data: any = $state(null),
    loading = $state(true),
    busy = $state(false),
    message = $state(''),
    failure = $state(false),
    tab = $state('dashboard'),
    loginEmail = $state(''),
    password = $state(''),
    code = $state(''),
    employeeName = $state(''),
    employeeEmail = $state(''),
    testEmail = $state(''),
    roleName = $state(''),
    rolePermissions: string[] = $state([]),
    adminEmail = $state(''),
    adminPassword = $state(''),
    adminRole = $state('coordinator'),
    createdSecret = $state(''),
    selectedRound = $state(''),
    preview: any = $state(null),
    resolution = $state('confirmed'),
    resolutionNote = $state(''),
    resolutionConfirmed = $state(false);
  let round = $state({
    day: calendarDate(),
    invite: '11:45',
    close: '12:00',
    send: '12:05',
    arrival: '12:30',
    paymentMode: 'individual',
  });
  let paymentMode = $state('individual'),
    paymentLink = $state('');
  let times = $state({ id: '', close: '', send: '', arrival: '', confirmCorrection: false });
  const can = (p: string) =>
    data?.admin.permissions.includes('*') || data?.admin.permissions.includes(p);
  const nav = $derived(
    [
      { id: 'dashboard', name: 'Overzicht', icon: '◫', permission: '' },
      { id: 'rounds', name: 'Bestelrondes', icon: '◷', permission: 'rounds' },
      { id: 'employees', name: 'Medewerkers', icon: '♙', permission: 'employees' },
      { id: 'roles', name: 'Rollen & rechten', icon: '⚿', permission: 'roles' },
      { id: 'menu', name: 'Menukaart', icon: '☷', permission: 'menu' },
      { id: 'mail', name: 'E-mail', icon: '✉', permission: 'mail' },
      { id: 'payments', name: 'Betalingen', icon: '€', permission: 'payments' },
      { id: 'settings', name: 'Instellingen', icon: '⚙', permission: 'settings' },
      { id: 'diagnostics', name: 'Diagnostiek', icon: '◇', permission: 'diagnostics' },
      { id: 'audit', name: 'Auditlog', icon: '≡', permission: 'audit' },
    ].filter((n) => !n.permission || can(n.permission)),
  );
  const active = $derived(
    data?.rounds.find((r: any) => !['completed', 'cancelled'].includes(r.status)),
  );
  const orders = $derived(
    data?.orders.filter((o: any) => o.round_id === (selectedRound || active?.id)) || [],
  );
  async function load() {
    try {
      data = await api('admin');
      syncState = data.syncStatus;
    } catch (e) {
      if (e instanceof Error && !e.message.includes('Log in')) {
        failure = true;
        message = e.message;
      }
    }
    loading = false;
  }
  let syncState: any = $state(null),
    syncPollError = $state(''),
    syncLastReference = $state(''),
    syncUncertain = $state(false);
  let polling = false,
    disposed = false,
    pollController: AbortController | undefined,
    nextPollAt = 0,
    pollFailures = 0;
  let roundRequest: { requestId: string; signature: string; input: typeof round } | null =
    $state(null);
  let roundUncertain = $state(false);
  function persistRoundRequest() {
    try {
      sessionStorage.setItem('smikkelbeer.round-request', JSON.stringify(roundRequest));
    } catch {
      /* Storage may be disabled; server idempotency remains in force for this page. */
    }
  }
  async function showRoundResult(result: any) {
    roundUncertain = false;
    if (result.job) {
      syncState = { ...syncState, job: result.job };
      if (['failed', 'interrupted'].includes(result.job.status)) {
        roundRequest = null;
        persistRoundRequest();
        failure = true;
        message = syncMessage(result.job);
      } else if (result.roundId) message = 'De ronde is aangemaakt en staat in het overzicht.';
      else
        message =
          'De menukaart moet opnieuw worden gecontroleerd. De broncontrole loopt op de achtergrond; volg hieronder de voortgang.';
    } else if (result.roundId)
      message = 'De ronde is aangemaakt met een recente, volledig gecontroleerde menukaart.';
    if (result.roundId) {
      try {
        const fresh = await api('admin', undefined, {
          signal: pollController?.signal || AbortSignal.timeout(10000),
        });
        if (!disposed && data) {
          data.rounds = fresh.rounds;
          data.orders = fresh.orders;
        }
      } catch {
        message =
          'De ronde is aangemaakt. Het overzicht kon niet worden vernieuwd; herlaad de pagina.';
      }
    }
  }
  async function recoverRoundCreation() {
    if (!roundRequest) return false;
    try {
      const result = await api('rounds/create/status?id=' + roundRequest.requestId, undefined, {
        signal: pollController?.signal,
      });
      await showRoundResult(result);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.httpStatus === 404) return false;
      throw e;
    }
  }
  async function startRound() {
    const signature = JSON.stringify(round);
    const oldJob = syncState?.job;
    if (
      roundRequest?.signature !== signature ||
      (oldJob?.purpose === 'round.create' && ['failed', 'interrupted'].includes(oldJob.status))
    ) {
      roundRequest = { requestId: crypto.randomUUID(), signature, input: { ...round } };
      persistRoundRequest();
    }
    const request = roundRequest!;
    try {
      if (roundUncertain && (await recoverRoundCreation())) return;
      roundUncertain = true;
      const result = await api('rounds/create', { ...request.input, requestId: request.requestId });
      await showRoundResult(result);
    } catch (e) {
      if (e instanceof ApiError && (e.httpStatus === 0 || e.httpStatus >= 500)) {
        if (e.requestId) syncLastReference = e.requestId;
        try {
          if (await recoverRoundCreation()) return;
        } catch {
          /* Polling retries the status, never the POST. */
        }
      } else roundUncertain = false;
      throw e;
    }
  }
  const syncActive = $derived(['queued', 'running'].includes(syncState?.job?.status));
  const syncLabels: Record<string, string> = {
    queued: 'In wachtrij',
    running: 'Bezig',
    succeeded: 'Geslaagd',
    failed: 'Mislukt',
    interrupted: 'Onderbroken',
  };
  const syncTitles: Record<string, string> = {
    menu: 'Menukaartsynchronisatie',
    'round.create': 'Broncontrole en ronde voorbereiden',
    'round.validate': 'Broncontrole vóór verzending',
  };
  function syncMessage(job: any) {
    return job.status === 'succeeded'
      ? job.purpose === 'menu'
        ? job.total + ' producten volledig gecontroleerd.'
        : job.purpose === 'round.create'
          ? 'Menukaart gecontroleerd; de nieuwe ronde staat in het overzicht.'
          : 'Menukaart gecontroleerd; bekijk de verzendstatus van de ronde.'
      : job.error?.message || 'De synchronisatie is onderbroken.';
  }
  async function pollSync(force = false) {
    if (
      disposed ||
      polling ||
      !data ||
      (!can('menu') && !can('rounds')) ||
      (!force && !syncActive && !syncUncertain && !roundUncertain) ||
      (!force && Date.now() < nextPollAt)
    )
      return;
    polling = true;
    pollController = new AbortController();
    const timeout = setTimeout(() => pollController?.abort(), 10000);
    const previous = syncState?.job;
    try {
      if (roundUncertain && roundRequest) {
        if (!(await recoverRoundCreation()))
          syncPollError =
            'De rondeaanvraag is nog niet geregistreerd. Klik opnieuw op Ronde aanmaken om met hetzelfde aanvraag-ID te proberen.';
        return;
      }
      const state = await api('menu/sync/status', undefined, { signal: pollController.signal });
      if (disposed) return;
      syncState = state;
      syncPollError = '';
      syncUncertain = false;
      pollFailures = 0;
      nextPollAt = 0;
      if (
        previous &&
        ['queued', 'running'].includes(previous.status) &&
        state.job &&
        !['queued', 'running'].includes(state.job.status)
      ) {
        if (
          state.job.purpose === 'round.create' &&
          ['failed', 'interrupted'].includes(state.job.status)
        ) {
          roundRequest = null;
          persistRoundRequest();
        }
        message = syncMessage(state.job);
        failure = state.job.status !== 'succeeded';
        const fresh = await api('admin');
        if (!disposed && data) {
          data.rounds = fresh.rounds;
          data.orders = fresh.orders;
          data.syncs = fresh.syncs;
        }
      }
    } catch (e) {
      if (disposed) return;
      syncPollError = e instanceof Error ? e.message : 'De status kon niet worden opgehaald.';
      if (e instanceof ApiError && e.requestId) syncLastReference = e.requestId;
      pollFailures++;
      nextPollAt = Date.now() + Math.min(15000, 2000 * 2 ** Math.min(pollFailures, 3));
    } finally {
      clearTimeout(timeout);
      polling = false;
      pollController = undefined;
    }
  }
  async function startSync(path = 'menu/sync', payload: unknown = {}) {
    syncPollError = '';
    syncLastReference = '';
    try {
      const r = await api(path, payload);
      if (r.job) {
        syncState = { ...syncState, job: r.job };
        message = r.reused
          ? 'De bestaande synchronisatie wordt gevolgd.'
          : 'Broncontrole gestart. Je kunt dit scherm sluiten; de taak loopt op de server door.';
      } else message = 'Ronde afgehandeld.';
    } catch (e) {
      if (e instanceof ApiError && (e.httpStatus === 0 || e.httpStatus >= 500)) {
        syncUncertain = true;
        if (e.requestId) syncLastReference = e.requestId;
        await pollSync(true);
      }
      throw e;
    }
  }
  onMount(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('smikkelbeer.round-request') || 'null');
      if (stored?.requestId && stored?.signature && stored?.input) {
        roundRequest = stored;
        round = stored.input;
        roundUncertain = true;
      }
    } catch {
      /* Private browsing may deny storage access. */
    }
    void load();
    const timer = setInterval(() => void pollSync(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      pollController?.abort();
    };
  });
  async function action(fn: () => Promise<void>, refresh = true) {
    busy = true;
    message = '';
    failure = false;
    try {
      await fn();
      if (refresh) await load();
      if (!message) message = 'Opgeslagen.';
    } catch (e) {
      failure = true;
      message = e instanceof Error ? e.message : 'Actie mislukt';
      if (e instanceof ApiError && e.requestId) message += ' Cloudflare-referentie: ' + e.requestId;
    } finally {
      busy = false;
    }
  }
  function editTimes(r: any) {
    times = {
      id: r.id,
      close: time(r.closes),
      send: time(r.sends),
      arrival: time(r.arrives),
      confirmCorrection: false,
    };
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    message = 'Gekopieerd.';
  }
</script>

{#if !data}<header class="site-header">
    <a class="brand" href="/">ʕ•ᴥ•ʔ smikkelbeer.</a><span class="header-caption"
      >Beheerdersomgeving</span
    >
  </header>
  <main class="login-card panel">
    <div class="eyebrow">Alles lekker geregeld</div>
    <h1>Welkom terug.</h1>
    {#if loading}<p>Beveiligde sessie controleren…</p>{:else}<p class="muted">
        Log in met je beheeraccount en authenticator.
      </p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          action(async () => {
            await api('admin/login', { email: loginEmail, password, code });
            password = '';
            code = '';
          });
        }}
      >
        <label
          >E-mailadres<input
            type="email"
            bind:value={loginEmail}
            required
            autocomplete="username"
          /></label
        ><label
          >Wachtwoord<input
            type="password"
            bind:value={password}
            required
            autocomplete="current-password"
          /></label
        ><label
          >Authenticatorcode<input
            bind:value={code}
            inputmode="numeric"
            pattern={'[0-9]{6}'}
            required
            autocomplete="one-time-code"
          /></label
        ><button class="primary full" disabled={busy}>Veilig inloggen →</button>
      </form>
      <a class="subtle-link" href="/setup">Eerste installatie</a>{/if}{#if message}<p
        class:danger={failure}
        class="notice"
        role="status"
      >
        {message}
      </p>{/if}
  </main>
{:else}<div class="admin-shell">
    <aside class="sidebar">
      <a class="brand" href="/">ʕ•ᴥ•ʔ smikkelbeer.</a>
      <div class="workspace-label">BEHEEROMGEVING</div>
      <nav>
        {#each nav as n}<button
            class:active={tab === n.id}
            onclick={() => {
              tab = n.id;
              preview = null;
            }}><span aria-hidden="true">{n.icon}</span>{n.name}</button
          >{/each}
      </nav>
      <div class="sidebar-bottom">
        <span class="secure-mark">◈ MFA beveiligd</span><small>{data.admin.name}</small><button
          class="text-button"
          onclick={() =>
            action(async () => {
              await api('logout', { kind: 'admin' });
              roundRequest = null;
              roundUncertain = false;
              persistRoundRequest();
              data = null;
            }, false)}>Uitloggen →</button
        >
      </div>
    </aside>
    <div class="admin-content">
      <header class="admin-header">
        <span>Team I&A <span class="muted">/</span> {nav.find((n) => n.id === tab)?.name}</span><a
          href="/"
          class="subtle-link">Medewerkerswebsite ↗</a
        >
      </header>
      <main class="admin-main">
        <div class="page-heading">
          <div>
            <div class="eyebrow">Smikkelbeer beheer</div>
            <h1>{nav.find((n) => n.id === tab)?.name}</h1>
            <p class="muted">Samen bestellen, met overzicht en controle.</p>
          </div>
          <span class="pill">Europe/Amsterdam</span>
        </div>
        {#if message}<div class:danger={failure} class="notice" role="status">{message}</div>{/if}
        {#if (can('menu') || can('rounds')) && (syncState?.job || syncUncertain)}
          <section class="panel sync-progress" aria-label="Synchronisatiestatus">
            <div class="section-heading">
              <h2>{syncTitles[syncState?.job?.purpose] || 'Menukaartsynchronisatie'}</h2>
              <span class="pill">{syncLabels[syncState?.job?.status] || 'Status opvragen'}</span>
            </div>
            {#if syncState?.job}{@const job = syncState.job}
              <progress
                aria-label="Gecontroleerde producten"
                value={job.processed}
                max={Math.max(1, job.total)}
              ></progress>
              <p role="status">
                {job.total
                  ? job.processed + ' van ' + job.total + ' producten gecontroleerd.'
                  : job.status === 'queued'
                    ? 'De taak wacht op verwerking.'
                    : job.status === 'running'
                      ? 'De menukaart wordt opgehaald.'
                      : 'Er zijn nog geen producten gecontroleerd.'}
              </p>
              {#if job.phase === 'applying' && syncActive}<p>
                  Alle producten zijn gecontroleerd; de ronde wordt verwerkt.
                </p>{/if}
              {#if job.error}<p class="notice danger" role="alert">{job.error.message}</p>
                <small
                  >Diagnose: {job.error.code}{job.error.productId
                    ? ' · bronproduct ' + job.error.productId
                    : ''}</small
                >{/if}
              <p class="muted small">
                Taak {job.id} · bijgewerkt {date(job.updatedAt)}. Een fout of onderbreking
                overschrijft geen geldige ronde-momentopnamen.
              </p>
            {/if}
            {#if syncState?.lastSuccess}<p class="muted small">
                Laatste volledig geslaagde broncontrole: {date(syncState.lastSuccess.at)}.
              </p>{/if}
            {#if syncPollError}<p class="notice danger" role="alert">{syncPollError}</p>{/if}
            {#if syncLastReference}<p class="muted small">
                Laatste Cloudflare-referentie: {syncLastReference}
              </p>{/if}
            <button class="secondary" onclick={() => pollSync(true)}>Status opnieuw ophalen</button>
          </section>
        {/if}
        {#if tab === 'dashboard'}<div class="stats-grid">
            <article class="stat">
              <span>Huidige ronde</span><strong
                >{active ? statusLabel[active.status] : 'Geen actieve ronde'}</strong
              ><small>{active?.number || 'Klaar voor de volgende pauze'}</small>
            </article>
            <article class="stat">
              <span>Bestellingen</span><strong
                >{data.orders.filter((o: any) => o.round_id === active?.id && !o.declined)
                  .length}</strong
              ><small>Deze ronde</small>
            </article>
            <article class="stat">
              <span>Totaalbedrag</span><strong
                >{money(
                  data.orders
                    .filter((o: any) => o.round_id === active?.id)
                    .reduce((n: number, o: any) => n + o.total, 0),
                )}</strong
              ><small>Bedragen uit opgeslagen bestellingen</small>
            </article>
          </div>
          <div class="admin-grid">
            <section class="panel">
              <div class="section-heading">
                <h2>De eerstvolgende smikkelpauze</h2>
                <span class="live-dot"></span>
              </div>
              {#if active}<h3>{active.day}</h3>
                <div class="timeline">
                  <div><small>Sluiting</small><strong>{time(active.closes)}</strong></div>
                  <div><small>Verzending</small><strong>{time(active.sends)}</strong></div>
                  <div><small>Aankomst</small><strong>{time(active.arrives)}</strong></div>
                </div>
                <p class="pill">{statusLabel[active.status]}</p>
                {#if active.issue}<p class="notice danger">
                    {active.issue}
                  </p>{/if}{#if can('rounds')}<button
                    class="secondary"
                    onclick={() => {
                      editTimes(active);
                      tab = 'rounds';
                    }}>Tijden snel aanpassen →</button
                  >{/if}{:else}<p class="empty">Er staat nog geen ronde klaar.</p>{/if}
            </section>
            <section class="panel">
              <h2>Goed om te weten</h2>
              <p>
                {data.orders.filter((o: any) => o.round_id === active?.id && o.declined).length} medewerkers
                doen deze keer niet mee.
              </p>
              {#if can('employees')}<p>
                  {data.employees.filter(
                    (e: any) => e.active && e.preferences.participation === 'paused',
                  ).length} medewerkers hebben uitnodigingen gepauzeerd.
                </p>
                <p>
                  {data.employees.filter(
                    (e: any) =>
                      e.active &&
                      e.preferences.participation === 'away' &&
                      e.preferences.from <= active?.day &&
                      e.preferences.until >= active?.day,
                  ).length} medewerkers zijn afwezig.
                </p>
                <p>
                  {data.employees.filter(
                    (e: any) =>
                      e.active &&
                      e.preferences.participation !== 'paused' &&
                      e.preferences.skipRound !== active?.id &&
                      !(
                        e.preferences.participation === 'away' &&
                        e.preferences.from <= active?.day &&
                        e.preferences.until >= active?.day
                      ) &&
                      !data.orders.some(
                        (o: any) => o.round_id === active?.id && o.employee_id === e.id,
                      ),
                  ).length} reacties ontbreken nog.
                </p>{/if}
              <p class="muted small">
                Een onzekere verzendstatus vereist altijd handmatige controle in de mailbox.
              </p>
            </section>
          </div>
        {:else if tab === 'rounds'}<section class="panel">
            <h2>Nieuwe bestelronde</h2>
            {#if roundUncertain}<p role="status">
                De uitkomst van rondeaanvraag {roundRequest?.requestId} wordt gecontroleerd. Opnieuw klikken
                gebruikt hetzelfde aanvraag-ID.
              </p>{/if}
            {#if roundUncertain && syncPollError}<p class="error" role="alert">
                {syncPollError}
              </p>{/if}
            <p class="muted small">
              Een volledig gecontroleerde menukaart van maximaal 30 minuten oud wordt direct
              gebruikt. Anders volgt een afzonderlijke broncontrole met voortgang. Vóór verzending
              wordt de bron altijd opnieuw gecontroleerd.
            </p>
            <form
              onsubmit={(e) => {
                e.preventDefault();
                if (busy || syncActive) return;
                action(startRound, false);
              }}
            >
              <div class="form-grid">
                <label>Datum<input type="date" bind:value={round.day} required /></label><label
                  >Uitnodigen<input type="time" bind:value={round.invite} required /></label
                ><label>Sluiten<input type="time" bind:value={round.close} required /></label><label
                  >Verzenden<input type="time" bind:value={round.send} required /></label
                ><label>Aankomst<input type="time" bind:value={round.arrival} required /></label
                ><label
                  >Betaling<select bind:value={round.paymentMode}
                    ><option value="individual">Individueel bij de cafetaria</option><option
                      value="advance">Voorschieten en terugbetalen</option
                    ></select
                  ></label
                >
              </div>
              <button class="primary" disabled={busy || syncActive}
                >{syncActive
                  ? 'Broncontrole loopt…'
                  : busy
                    ? 'Opdracht starten…'
                    : 'Ronde aanmaken'}</button
              >
            </form>
          </section>
          {#if times.id}<section class="panel">
              <h2>Tijden snel aanpassen</h2>
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api('rounds/times', times);
                    times.id = '';
                  });
                }}
              >
                <div class="form-grid">
                  <label>Sluiting<input type="time" required bind:value={times.close} /></label
                  ><label>Verzending<input type="time" required bind:value={times.send} /></label
                  ><label>Aankomst<input type="time" required bind:value={times.arrival} /></label>
                </div>
                <label class="check"
                  ><input type="checkbox" bind:checked={times.confirmCorrection} /> Ik bevestig bij een
                  reeds verzonden ronde een afzonderlijke aankomstcorrectiemail.</label
                ><button class="primary" disabled={busy}>Tijden opslaan</button>
              </form>
            </section>{/if}
          <div class="table-wrap panel">
            <table>
              <thead><tr><th>Ronde</th><th>Tijden</th><th>Status</th><th>Acties</th></tr></thead
              ><tbody
                >{#each data.rounds as r}<tr
                    ><td
                      ><strong>{r.day}</strong><small>{r.number} {r.test ? '· TEST' : ''}</small
                      ></td
                    ><td>{time(r.closes)} / {time(r.sends)} / {time(r.arrives)}</td><td
                      ><span class="pill">{statusLabel[r.status]}</span>{#if r.issue}<small
                          class="coral">{r.issue}</small
                        >{/if}</td
                    ><td
                      ><div class="button-group">
                        <button class="secondary" onclick={() => editTimes(r)}>Tijden</button
                        ><button
                          class="secondary"
                          onclick={() =>
                            action(async () => {
                              preview = await api('round/' + r.id);
                              selectedRound = r.id;
                            }, false)}>Overzicht</button
                        >{#if ['planned', 'open', 'closed', 'blocked'].includes(r.status)}<button
                            class="text-button"
                            disabled={busy}
                            onclick={() =>
                              action(async () => {
                                await api('rounds/cancel', { id: r.id });
                              })}>Annuleren</button
                          >{/if}{#if r.status === 'blocked'}<button
                            class="secondary"
                            disabled={busy}
                            onclick={() =>
                              action(async () => {
                                await startSync('rounds/recheck', { id: r.id });
                              })}>Bron opnieuw controleren</button
                          >{/if}
                      </div></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          {#if preview}<section class="panel">
              <h2>{preview.round.number} · besteloverzicht</h2>
              {#each preview.orders as o}<h3>{o.name} · {money(o.total)}</h3>
                {#each o.lines as l}<p>
                    {l.quantity} × {l.name}
                    {l.options.join(', ')}
                    {l.note} · {money(l.total)}
                  </p>{/each}{/each}{#if ['unknown', 'sent', 'review', 'confirmed'].includes(preview.round.status)}<hr
                />
                <h3>Handmatige beoordeling</h3>
                <form
                  onsubmit={(e) => {
                    e.preventDefault();
                    action(async () => {
                      await api('rounds/resolve', {
                        id: preview.round.id,
                        outcome: resolution,
                        note: resolutionNote,
                        confirmed: resolutionConfirmed,
                      });
                      preview = null;
                    });
                  }}
                >
                  <label
                    >Uitkomst<select bind:value={resolution}
                      ><option value="sent">Verzonden, nog niet bevestigd</option><option
                        value="confirmed">Ontvangst bevestigd</option
                      ><option value="completed">Afgehandeld</option></select
                    ></label
                  ><label
                    >Onderbouwing<textarea bind:value={resolutionNote} minlength="10" required
                    ></textarea></label
                  ><label class="check"
                    ><input type="checkbox" bind:checked={resolutionConfirmed} required /> Ik heb de daadwerkelijke
                    mailbox of cafetaria gecontroleerd.</label
                  ><button class="primary" disabled={busy}>Beoordeling vastleggen</button>
                </form>{/if}
            </section>{/if}
        {:else if tab === 'employees'}<section class="panel">
            <h2>Medewerker toevoegen</h2>
            <form
              onsubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api('employees/create', { name: employeeName, email: employeeEmail });
                  employeeName = '';
                  employeeEmail = '';
                });
              }}
            >
              <div class="form-grid">
                <label>Voornaam<input required maxlength="50" bind:value={employeeName} /></label
                ><label>E-mailadres<input required type="email" bind:value={employeeEmail} /></label
                >
              </div>
              <button class="primary" disabled={busy}>Medewerker toevoegen</button>
            </form>
            <p class="muted small">Een beheeraccount is nooit automatisch een medewerkeraccount.</p>
          </section>
          <div class="panel table-wrap">
            <table>
              <thead
                ><tr><th>Voornaam</th><th>E-mailadres</th><th>Deelname</th><th>Acties</th></tr
                ></thead
              ><tbody
                >{#each data.employees as e}<tr
                    ><td><input aria-label={'Voornaam ' + e.name} bind:value={e.name} /></td><td
                      >{e.email}</td
                    ><td
                      >{!e.active
                        ? 'Gedeactiveerd'
                        : e.preferences.participation === 'paused'
                          ? 'Gepauzeerd'
                          : e.preferences.participation === 'away'
                            ? e.preferences.from + ' t/m ' + e.preferences.until
                            : 'Normaal'}</td
                    ><td
                      ><div class="button-group">
                        <button
                          class="secondary"
                          disabled={busy}
                          onclick={() =>
                            action(async () => {
                              await api('employees/update', {
                                id: e.id,
                                active: !!e.active,
                                name: e.name,
                              });
                            })}>Naam opslaan</button
                        ><button
                          class="secondary"
                          disabled={busy || !e.active}
                          onclick={() =>
                            action(async () => {
                              await api('employees/invite', { id: e.id });
                            })}>Uitnodigen</button
                        ><button
                          class="text-button"
                          disabled={busy}
                          onclick={() =>
                            action(async () => {
                              await api('employees/update', {
                                id: e.id,
                                name: e.name,
                                active: !e.active,
                              });
                            })}>{e.active ? 'Deactiveren' : 'Activeren'}</button
                        ><button
                          class="text-button"
                          disabled={busy}
                          onclick={() =>
                            action(async () => {
                              await api('employees/revoke', { id: e.id });
                            })}>Links intrekken</button
                        >
                      </div></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        {:else if tab === 'roles'}<div class="admin-grid">
            <section class="panel">
              <h2>Nieuwe rol</h2>
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api('roles', { name: roleName, permissions: rolePermissions });
                    roleName = '';
                    rolePermissions = [];
                  });
                }}
              >
                <label>Rolnaam<input bind:value={roleName} required /></label
                >{#each data.permissions as p}<label class="check"
                    ><input type="checkbox" value={p} bind:group={rolePermissions} />{p}</label
                  >{/each}<button class="primary" disabled={busy}>Rol toevoegen</button>
              </form>
            </section>
            <section class="panel">
              <h2>Beheeraccount toevoegen</h2>
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    const r = await api('admins/create', {
                      email: adminEmail,
                      password: adminPassword,
                      roleId: adminRole,
                    });
                    createdSecret = r.secret;
                    adminPassword = '';
                  });
                }}
              >
                <label>E-mail<input type="email" required bind:value={adminEmail} /></label><label
                  >Wachtwoord<input
                    type="password"
                    required
                    minlength="14"
                    bind:value={adminPassword}
                    autocomplete="new-password"
                  /></label
                ><label
                  >Rol<select bind:value={adminRole}
                    >{#each data.roles as r}<option value={r.id}>{r.name}</option>{/each}</select
                  ></label
                ><button class="primary" disabled={busy}>Account met verplichte MFA maken</button>
              </form>
              {#if createdSecret}<p>MFA-sleutel, eenmalig zichtbaar. Deel via een veilig kanaal:</p>
                <code class="secret">{createdSecret}</code><button
                  class="secondary"
                  onclick={() => (createdSecret = '')}>Sleutel verbergen</button
                >{/if}
            </section>
          </div>
          <section class="panel">
            <h2>Rollen</h2>
            {#each data.roles as r}<article class="role-editor">
                {#if r.system}<p>
                    <strong>{r.name}</strong> · {r.permissions.join(', ')}
                  </p>{:else}<label>Rolnaam<input bind:value={r.name} required /></label>
                  <div class="weekday-group">
                    {#each data.permissions as permission}<label class="check"
                        ><input
                          type="checkbox"
                          value={permission}
                          bind:group={r.permissions}
                        />{permission}</label
                      >{/each}
                  </div>
                  <button
                    class="secondary"
                    disabled={busy}
                    onclick={() =>
                      action(async () => {
                        await api('roles/update', {
                          id: r.id,
                          name: r.name,
                          permissions: r.permissions,
                        });
                      })}>Rol opslaan</button
                  >
                  <button
                    class="text-button"
                    disabled={busy}
                    onclick={() =>
                      action(async () => {
                        await api('roles/delete', { id: r.id });
                      })}>Rol verwijderen</button
                  >{/if}
              </article>{/each}
          </section>
          <div class="panel table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Rol</th><th>Actief</th><th></th></tr></thead><tbody
                >{#each data.admins as a}<tr
                    ><td>{a.email}</td><td
                      ><select bind:value={a.role_id}
                        >{#each data.roles as r}<option value={r.id}>{r.name}</option
                          >{/each}</select
                      ></td
                    ><td
                      ><input
                        type="checkbox"
                        aria-label={'Actief ' + a.email}
                        checked={!!a.active}
                        onchange={(e) => (a.active = e.currentTarget.checked ? 1 : 0)}
                      /></td
                    ><td
                      ><button
                        class="secondary"
                        disabled={busy}
                        onclick={() =>
                          action(async () => {
                            await api('admins/update', {
                              id: a.id,
                              roleId: a.role_id,
                              active: !!a.active,
                            });
                          })}>Opslaan</button
                      ></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        {:else if tab === 'menu'}<section class="panel">
            <h2>De cafetaria is de bron</h2>
            <p>
              Producten, opties en prijzen kunnen uitsluitend via de officiële website worden
              gesynchroniseerd. Iedere ronde behoudt de eigen onveranderlijke momentopname.
            </p>
            <button
              class="primary"
              disabled={busy || syncActive}
              onclick={() =>
                action(async () => {
                  await startSync();
                })}>{syncActive ? 'Synchronisatie loopt…' : 'Menukaart synchroniseren'}</button
            >
          </section>
          <div class="panel table-wrap">
            <table>
              <thead><tr><th>Tijdstip</th><th>Resultaat</th><th>Diagnose</th></tr></thead><tbody
                >{#each data.syncs as s}<tr
                    ><td>{date(s.at)}</td><td>{s.success ? 'Geslaagd' : 'Geblokkeerd'}</td><td
                      >{s.error || 'Menukaart en opties gevalideerd'}</td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        {:else if tab === 'mail'}<section class="panel">
            <h2>Verbinding testen</h2>
            <p class="muted">
              Testmails gaan uitsluitend naar de toegestane testadressen uit Instellingen.
            </p>
            <form
              onsubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api('mail/test', { email: testEmail });
                });
              }}
            >
              <label
                >Expliciet testadres<input type="email" required bind:value={testEmail} /></label
              ><button class="primary" disabled={busy}>Testmail klaarzetten</button>
              <button
                type="button"
                class="secondary"
                disabled={busy}
                onclick={() =>
                  action(async () => {
                    await api('mail/poll', {});
                  })}>Mailbox controleren</button
              >
            </form>
          </section>
          <div class="panel table-wrap">
            <h2>Uitgaande berichten</h2>
            <table>
              <thead
                ><tr><th>Onderwerp</th><th>Ontvanger</th><th>Status</th><th>Diagnose</th></tr
                ></thead
              ><tbody
                >{#each data.mail as m}<tr
                    ><td>{m.subject}<small>{date(m.created)}</small></td><td>{m.recipient}</td><td
                      >{statusLabel[m.status] || m.status}</td
                    ><td>{m.error || '—'}</td></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          <section class="panel">
            <h2>Inkomende ontvangstbevestigingen</h2>
            <p class="muted small">
              Onbetrouwbare e-mailinhoud wordt als tekst getoond. Ontvangst bevestigen doe je bij de
              ronde na controle.
            </p>
            {#each data.inbox as m}<article class="inbox-card">
                <strong>{m.subject}</strong>
                <p>{m.sender} · {date(m.at)}</p>
                <p>{m.reason}</p>
                <pre>{m.excerpt}</pre>
              </article>{/each}{#if !data.inbox.length}<p>Geen berichten ter beoordeling.</p>{/if}
          </section>
        {:else if tab === 'payments'}<section class="panel">
            <h2>Terugbetalingen</h2>
            <p class="muted">
              Deze statussen worden handmatig bijgehouden en zijn geen geverifieerde bankbetalingen.
            </p>
            <label
              >Bestelronde<select bind:value={selectedRound}
                ><option value="">Actieve ronde</option>{#each data.rounds as r}<option value={r.id}
                    >{r.day} · {r.number}</option
                  >{/each}</select
              ></label
            >
            <div class="form-grid">
              <label
                >Betaalwijze voor geselecteerde ronde<select bind:value={paymentMode}
                  ><option value="individual">Individueel bij de cafetaria</option><option
                    value="advance">Voorschieten en terugbetalen</option
                  ></select
                ></label
              ><label
                >Betaalverzoeklink voor deze ronde<input
                  type="url"
                  bind:value={paymentLink}
                /></label
              >
            </div>
            <button
              class="secondary"
              disabled={busy || !(selectedRound || active?.id)}
              onclick={() =>
                action(async () => {
                  await api('payments/round', {
                    id: selectedRound || active.id,
                    mode: paymentMode,
                    link: paymentLink,
                  });
                })}>Betaalinstellingen voor ronde opslaan</button
            >
            <div class="row">
              <strong>Totaal {money(orders.reduce((n: number, o: any) => n + o.total, 0))}</strong
              ><button
                class="secondary"
                onclick={() =>
                  action(async () => {
                    await copy(
                      orders
                        .filter((o: any) => !o.paid && !o.declined)
                        .map((o: any) => o.name + ': ' + money(o.total))
                        .join('\n'),
                    );
                  }, false)}>Openstaande bedragen kopiëren</button
              >
            </div>
          </section>
          <div class="panel table-wrap">
            <table>
              <thead
                ><tr><th>Voornaam</th><th>Bedrag</th><th>Status</th><th>Kopiëren</th></tr></thead
              ><tbody
                >{#each orders.filter((o: any) => !o.declined) as o}<tr
                    ><td>{o.name}</td><td>{money(o.total)}</td><td
                      ><label class="check"
                        ><input
                          type="checkbox"
                          checked={!!o.paid}
                          disabled={busy}
                          onchange={(e) =>
                            action(async () => {
                              await api('payments', { id: o.id, paid: e.currentTarget.checked });
                            })}
                        /> Handmatig betaald</label
                      ></td
                    ><td
                      ><button
                        class="secondary"
                        onclick={() =>
                          action(async () => {
                            await copy((o.total / 100).toFixed(2).replace('.', ','));
                          }, false)}>Bedrag kopiëren</button
                      ></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        {:else if tab === 'settings' && data.settings}<form
            onsubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const { smtpPasswordSet: _s, imapPasswordSet: _i, ...s } = data.settings;
                await api('settings', s);
              });
            }}
          >
            <section class="panel">
              <h2>Algemeen & veilige testmodus</h2>
              <div class="form-grid">
                <label
                  >Publieke HTTPS-URL<input
                    type="url"
                    required
                    bind:value={data.settings.publicUrl}
                  /></label
                ><label
                  >Bewaartermijn (dagen)<input
                    type="number"
                    min="30"
                    max="730"
                    bind:value={data.settings.retentionDays}
                  /></label
                ><label
                  >Inloglink geldig (minuten)<input
                    type="number"
                    min="5"
                    max="30"
                    bind:value={data.settings.tokenMinutes}
                  /></label
                >
              </div>
              <label class="check"
                ><input type="checkbox" bind:checked={data.settings.testMode} /> Veilige testmodus (standaard
                aan)</label
              ><label
                >Toegestane testadressen, komma-gescheiden<input
                  value={data.settings.testRecipients.join(', ')}
                  onchange={(e) =>
                    (data.settings.testRecipients = e.currentTarget.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean))}
                /></label
              >
              <p class="muted small">
                Gebruik nooit het cafetaria-adres als testadres. Test- en productierondes worden
                gescheiden.
              </p>
            </section>
            <section class="panel">
              <h2>Planning · Europe/Amsterdam</h2>
              <div class="weekday-group">
                {#each ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'] as d, i}<label class="check"
                    ><input
                      type="checkbox"
                      value={i + 1}
                      bind:group={data.settings.weekdays}
                    />{d}</label
                  >{/each}
              </div>
              <div class="form-grid">
                {#each [['inviteTime', 'Uitnodigingen'], ['closeTime', 'Sluiting'], ['sendTime', 'Verzending'], ['arrivalTime', 'Aankomst']] as field}<label
                    >{field[1]}<input
                      type="time"
                      required
                      bind:value={data.settings[field[0]]}
                    /></label
                  >{/each}<label
                  >Minimale voorbereiding (min.)<input
                    type="number"
                    min="10"
                    max="180"
                    bind:value={data.settings.minPreparation}
                  /></label
                ><label
                  >Herinnering voor sluiting (min.)<input
                    type="number"
                    min="5"
                    max="120"
                    bind:value={data.settings.reminderMinutes}
                  /></label
                ><label
                  >Waarschuwing na verzending (min.)<input
                    type="number"
                    min="5"
                    max="120"
                    bind:value={data.settings.confirmationMinutes}
                  /></label
                >
              </div>
              <label class="check"
                ><input type="checkbox" bind:checked={data.settings.secondReminder} /> Tweede herinnering
                op vijf minuten voor sluiting</label
              ><label
                >Uitzonderingsdagen (YYYY-MM-DD, komma-gescheiden)<input
                  value={data.settings.exceptions.join(', ')}
                  onchange={(e) =>
                    (data.settings.exceptions = e.currentTarget.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean))}
                /></label
              >
            </section>
            <section class="panel">
              <h2>Uitgaande e-mail · TLS verplicht</h2>
              <div class="form-grid">
                <label>SMTP-host<input bind:value={data.settings.smtp.host} /></label><label
                  >Poort<select bind:value={data.settings.smtp.port}
                    ><option value={465}>465 · TLS</option><option value={587}
                      >587 · STARTTLS vereist</option
                    ></select
                  ></label
                ><label
                  >Gebruikersnaam<input
                    bind:value={data.settings.smtp.user}
                    autocomplete="off"
                  /></label
                ><label
                  >Nieuw wachtwoord<input
                    type="password"
                    bind:value={data.settings.smtp.password}
                    placeholder={data.settings.smtpPasswordSet
                      ? 'Opgeslagen · leeg laten om te behouden'
                      : 'Nog niet ingesteld'}
                    autocomplete="new-password"
                  /></label
                ><label>Afzender<input type="email" bind:value={data.settings.smtp.from} /></label
                ><label
                  >Cafetaria-ontvanger<input
                    type="email"
                    bind:value={data.settings.cafeteria}
                  /></label
                ><label
                  >Coördinator voor waarschuwingen<input
                    type="email"
                    bind:value={data.settings.coordinator}
                  /></label
                >
              </div>
              <label
                >Uitnodigingstekst<textarea
                  bind:value={data.settings.templates.invitation}
                  maxlength="500"></textarea></label
              ><label
                >Bevestigingstekst<textarea
                  bind:value={data.settings.templates.confirmation}
                  maxlength="500"></textarea></label
              >
            </section>
            <section class="panel">
              <h2>Inkomende mailbox · IMAP over TLS</h2>
              <label class="check"
                ><input type="checkbox" bind:checked={data.settings.imap.enabled} /> Inkomende mailbox
                periodiek controleren</label
              >
              <div class="form-grid">
                <label>IMAP-host<input bind:value={data.settings.imap.host} /></label><label
                  >Gebruikersnaam<input
                    bind:value={data.settings.imap.user}
                    autocomplete="off"
                  /></label
                ><label
                  >Nieuw wachtwoord<input
                    type="password"
                    bind:value={data.settings.imap.password}
                    placeholder={data.settings.imapPasswordSet
                      ? 'Opgeslagen · leeg laten om te behouden'
                      : 'Nog niet ingesteld'}
                    autocomplete="new-password"
                  /></label
                >
              </div>
              <p class="muted small">
                Poort 993. OAuth2 is nog niet ondersteund; gebruik een door je provider toegestaan
                app-wachtwoord.
              </p>
            </section>
            <section class="panel">
              <h2>Menukaartbron</h2>
              <p>Vaste bron: https://www.hetcentrummarum.nl. Geen instelbare scraper-URL.</p>
              <label
                >Broncontrole vóór uitnodigingen (minuten)<input
                  type="number"
                  min="10"
                  max="120"
                  bind:value={data.settings.syncLeadMinutes}
                /></label
              >
              <label class="check"
                ><input type="checkbox" bind:checked={data.settings.scrapingApproved} /> Ik heb de voorwaarden
                en toestemming voor dit gebruik beoordeeld.</label
              ><label
                >Pauze tussen productverzoeken (milliseconden)<input
                  type="number"
                  min="1000"
                  max="10000"
                  bind:value={data.settings.syncIntervalMs}
                /></label
              >
            </section>
            <section class="panel">
              <h2>Betalingen</h2>
              <label
                >Standaard werkwijze<select bind:value={data.settings.paymentMode}
                  ><option value="individual">Iedereen betaalt bij de cafetaria</option><option
                    value="advance">Eén persoon schiet voor</option
                  ></select
                ></label
              ><label
                >Algemene bankonafhankelijke betaalverzoeklink<input
                  type="url"
                  bind:value={data.settings.paymentLink}
                /></label
              >
            </section>
            <div class="sticky-save">
              <button class="primary" disabled={busy}>Alle instellingen veilig opslaan</button>
            </div>
          </form>
        {:else if tab === 'diagnostics'}<section class="panel">
            <h2>Systeemcontroles</h2>
            <dl>
              <dt>Database</dt>
              <dd>{JSON.stringify(data.diagnostics?.database)}</dd>
              <dt>SMTP geconfigureerd</dt>
              <dd>{data.diagnostics?.mailConfigured ? 'Ja' : 'Nee'}</dd>
              <dt>IMAP ingeschakeld</dt>
              <dd>{data.diagnostics?.imapConfigured ? 'Ja' : 'Nee'}</dd>
              <dt>Brongebruik beoordeeld</dt>
              <dd>{data.diagnostics?.sourceApproved ? 'Ja' : 'Nee'}</dd>
              <dt>Testmodus</dt>
              <dd>{data.diagnostics?.testMode ? 'Ingeschakeld' : 'Uitgeschakeld'}</dd>
            </dl>
            <p class="notice">{data.diagnostics?.integrity}</p>
          </section>
          <section class="panel">
            <h2>Ronde simuleren met fictieve medewerkers</h2>
            <p>
              Gebruikt echte bronproducten uit een open testronde. Ontvangers blijven beperkt tot de
              expliciete testlijst.
            </p>
            <label
              >Open testronde<select bind:value={selectedRound}
                ><option value="">Kies een ronde</option
                >{#each data.rounds.filter((r: any) => r.test && r.status === 'open') as r}<option
                    value={r.id}>{r.number}</option
                  >{/each}</select
              ></label
            ><button
              class="primary"
              disabled={busy || !selectedRound}
              onclick={() =>
                action(async () => {
                  await api('diagnostics/simulate', { id: selectedRound });
                })}>Twee fictieve bestellingen toevoegen</button
            >
          </section>
        {:else if tab === 'audit'}<div class="panel table-wrap">
            <table>
              <thead
                ><tr><th>Tijdstip</th><th>Actor</th><th>Actie</th><th>Doel</th><th>Details</th></tr
                ></thead
              ><tbody
                >{#each data.audit as a}<tr
                    ><td>{date(a.at)}</td><td class="mono">{a.actor}</td><td>{a.action}</td><td
                      class="mono">{a.target}</td
                    ><td>{a.detail}</td></tr
                  >{/each}</tbody
              >
            </table>
          </div>{/if}
      </main>
    </div>
  </div>{/if}
