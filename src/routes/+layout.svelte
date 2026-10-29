<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head
  ><title>Smikkelbeer · Samen bestellen, lekker geregeld</title><meta
    name="description"
    content="Samen snacks bestellen bij Cafetaria 't Centrum in Marum."
  /></svelte:head
>
{@render children()}
