<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '#lib/client';
  let token = $state(''),
    message = $state(''),
    busy = $state(false);
  onMount(() => {
    token = window.location.hash.slice(1);
    history.replaceState(null, '', '/login');
  });
  async function confirm() {
    busy = true;
    try {
      await api('link/consume', { token });
      window.location.assign('/');
    } catch (e) {
      message = e instanceof Error ? e.message : 'Link ongeldig';
      busy = false;
    }
  }
</script>

<header class="site-header"><a class="brand" href="/">ʕ•ᴥ•ʔ smikkelbeer.</a></header>
<main class="login-card panel">
  <div class="eyebrow">Een veilige tussenstap</div>
  <h1>Klaar om te smikkelen?</h1>
  <p>
    Bevestig dat jij deze link wilt gebruiken. Het openen van de e-mail alleen logt je nog niet in.
  </p>
  <button class="primary full" disabled={!token || busy} onclick={confirm}
    >Bevestigen en doorgaan →</button
  >{#if message}<p class="notice danger" role="alert">{message}</p>{/if}<a
    class="subtle-link"
    href="/">Nieuwe link aanvragen</a
  >
</main>
