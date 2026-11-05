# web/src/routes/room

- [+page.svelte](+page.svelte): `/room?code=C`. Invite links point here. It looks the code up with `GET /api/rooms/:code` and opens the room's pool page (`/pool?id=N&code=C`); without a code it shows a code box.

The room itself is shown by [../../lib/components/RoomBanner.svelte](../../lib/components/RoomBanner.svelte) on the pool page; the room store can be found in [../../../../server/src/rooms.ts](../../../../server/src/rooms.ts).
