<script lang="ts">
  import { api } from '#lib/client';
  let token = $state(''),
    email = $state(''),
    password = $state(''),
    code = $state(''),
    secret = $state(''),
    uri = $state(''),
    message = $state(''),
    busy = $state(false);
  async function begin() {
    busy = true;
    try {
      const r = await api('setup/begin', { token, email, password });
      secret = r.secret;
      uri = r.uri;
      password = '';
      message = '';
    } catch (e) {
      message = e instanceof Error ? e.message : 'Installatie mislukt';
    }
    busy = false;
  }
  async function finish() {
    busy = true;
    try {
      await api('setup/finish', { token, code });
      window.location.assign('/admin');
    } catch (e) {
      message = e instanceof Error ? e.message : 'Code ongeldig';
    }
    busy = false;
  }
</script>

<header class="site-header"><a class="brand" href="/">ʕ•ᴥ•ʔ smikkelbeer.</a></header>
<main class="login-card panel">
  <div class="eyebrow">Veilige eerste installatie</div>
  <h1>Welkom, beheerder.</h1>
  {#if !secret}<p>
      Start lokaal in de container <code>node scripts/bootstrap.mjs</code>. De eenmalige
      installatiecode blijft 15 minuten geldig.
    </p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        begin();
      }}
    >
      <label
        >Installatiecode<input
          type="password"
          bind:value={token}
          required
          autocomplete="off"
        /></label
      ><label
        >Beheerders-e-mailadres<input
          type="email"
          bind:value={email}
          required
          autocomplete="username"
        /></label
      ><label
        >Sterk wachtwoord (minimaal 14 tekens)<input
          type="password"
          minlength="14"
          maxlength="128"
          bind:value={password}
          required
          autocomplete="new-password"
        /></label
      ><button class="primary full" disabled={busy}>Authenticator koppelen →</button>
    </form>{:else}<p>
      Voeg deze sleutel toe aan je authenticator. Bewaar hem in je beveiligde wachtwoordkluis; hij
      wordt maar eenmaal getoond.
    </p>
    <code class="secret">{secret}</code><a class="subtle-link" href={uri}>Open in authenticator</a>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        finish();
      }}
    >
      <label
        >Eenmalige zescijferige code<input
          bind:value={code}
          inputmode="numeric"
          pattern={'[0-9]{6}'}
          required
          autocomplete="one-time-code"
        /></label
      ><button class="primary full" disabled={busy}>Installatie afronden →</button>
    </form>{/if}{#if message}<p class="notice danger" role="alert">{message}</p>{/if}
</main>
