# web/src/routes/create

- [+page.svelte](+page.svelte): `/create`, "Open a room". Pick an item from the server's catalog, write the purpose (8 to 200 characters, stored with the offer on chain) and a duration (10, 20 or 30 minutes), then `POST /api/rooms`. The connected wallet is recorded as host. The response carries the room code, shown only to the creator, with a copy-link button.

To find how the server opens the pool and limits rooms visit [../../../../server/src/rooms.ts](../../../../server/src/rooms.ts) (`create`).
