# Sync Hardening — Risk Register & Plan

> Status: assessment complete 2026-07-02. Sources: code audit of `client/src-tauri/src/matrix.rs` /
> `client/src/App.tsx` (working tree), plus ecosystem research (Beeper blog, Synapse/matrix-rust-sdk
> issue trackers, mautrix docs). Goal: faster + more reliable sync than Beeper, with known red flags
> mitigated during the build phase instead of discovered in production.

## Framing

Beeper's "chats sync one by one" pain came from its legacy architecture (per-network sequential
polling, heavy client tech debt) — see [How Beeper Android Works](https://blog.beeper.com/2024/04/09/how-beeper-android-works/).
Simplified Sliding Sync (MSC4186) solves this structurally: the client fetches only what's needed to
render the visible UI, O(1) in room count (Element X claims <100 ms room list post-login,
[Element X: Ignition](https://element.io/blog/element-x-ignition/)). **We are on the right stack
(SyncService + matrix-rust-sdk), but the app-layer code currently bypasses most of its benefits.**

## Tier 1 — Reliability bugs in our code (fix first, cheap, high impact)

| # | Risk | Today | Mitigation |
|---|------|-------|------------|
| 1 | **Sync death is invisible.** Nothing observes `SyncService::state()`; if sync errors/terminates, the app looks alive but goes stale forever. Network drop / laptop sleep-wake: same. | Unhandled (`matrix.rs` — no `state()` usage) | Subscribe to the state stream; auto-restart with backoff; emit a `sync-state` Tauri event so UI can show connected / reconnecting / offline. SDK issue [#3935](https://github.com/matrix-org/matrix-rust-sdk/issues/3935) confirms offline-recovery is partly our job. |
| 2 | **Live open-room updates are propped up by a blind 3 s poll** (`App.tsx` ~200). The real-time path (`subscribe_room` + content-free `rooms-updated` ping) "proved unreliable" per its own comment. | Masked, not fixed | Use `matrix_sdk_ui::timeline::Timeline` per open room and stream its diffs to the frontend. Gets ordering, gap handling, and local-echo reconciliation from the SDK instead of brute-force refetch. Remove the poll once diffs are proven. |
| 3 | **No auth-failure handling.** `M_UNKNOWN_TOKEN` surfaces as opaque per-command error strings; session restore can't distinguish "no session" from "invalid session". | Unhandled | Central error mapping → forced re-login flow + distinct restore outcomes. |
| 4 | **Optimistic send has no transaction-id reconciliation** — the optimistic bubble is only cleared by coincidence of the full-refetch cadence. | Fragile | Solved for free by the Timeline migration (#2): SDK local echo. |

## Tier 2 — Scaling flaws (fix before the UI/UX phase; this is the "faster than Beeper" work)

| # | Risk | Today | Mitigation |
|---|------|-------|------------|
| 5 | **O(rooms) full rescan on every update tick.** `list_rooms` iterates every room with a `/messages` fetch per room, per `rooms-updated` event (potentially every 250 ms). Its own comment admits sliding sync "is the real fix". `account_map()` re-scans all rooms and is called twice per refresh. | Works at ~70 rooms, will not scale | Drive the inbox from `RoomListService` entries + latest-event data that sliding sync already delivers; send diffs to the frontend; cache the account map. |
| 6 | **No timeline cache** — opening a room always hits `/messages`; the 3 s poll repeats it. Cold start refetches everything. | Network-bound UX | Enable/use the SDK EventCache (persistent, lazy-loading since 2025) so opening a room renders from disk instantly, then updates live. This is the Element X cold-start pattern. |
| 7 | Unbounded `avatarCache`/`mediaCache` maps in the frontend; no eviction. | Slow leak | LRU cap; low priority. |
| 8 | `accept_all_invites` serial-joins with a 300 ms throttle to dodge an SDK event-cache panic ("chunk is not found"); large bridge imports scale at N×300 ms. | Workaround | Track matrix-sdk releases past 0.18 for the fix; keep throttle until then. |

## Tier 3 — Ecosystem/architecture risks (design against, monitor; mostly Phase 2)

| # | Risk | Notes | Mitigation |
|---|------|-------|------------|
| 9 | **Sliding-sync state resets.** Synapse can hard-reset a sliding-sync connection when too many updates accumulate ([synapse#17653](https://github.com/element-hq/synapse/issues/17653)); `$LAZY` membership gaps after resets ([#18782](https://github.com/element-hq/synapse/issues/18782)). | Full resync is a *when*, not *if* | App must survive full invalidation gracefully: "recovering" UI state, no data loss, no duplicate rendering. |
| 10 | **Bridge lifecycle.** WhatsApp: phone must check in ≤ every 12 days or the bridge needs re-login; backfill is off by default and **non-retroactive** (only new portal rooms); Synapse < 1.132 can back off a recovered bridge for up to an hour. Double-puppeting must be configured before first use for receipts/typing. ([mautrix docs](https://docs.mau.fi/bridges/general/backfill.html), [troubleshooting](https://docs.mau.fi/bridges/general/troubleshooting.html)) | Largely non-retroactive settings | Pin Synapse ≥ 1.132 + current bridges; set backfill + double-puppeting in config **before** linking accounts; Phase 2 = bridge health surfaced in-app (bridge state room events → status indicator). |
| 10 · **DONE** | Infra-chores 2026-07 | ✅ Synapse pinned `:latest` → **`v1.155.0`** in `infra/docker-compose.yml` (above the 1.132 appservice backoff-reset floor). ✅ Backfill + same-server automatic **double-puppeting** documented in [`SETUP.md`](../SETUP.md) §2 as pre-link hand-edit steps. | Backfill keys: `backfill.enabled: true`, `max_initial_messages: 50`, `max_catchup_messages: 500`. Double-puppet: `double_puppet.secrets: { localhost: as_token:<appservice.as_token> }` (bridge masquerades via its own AS token; same-homeserver, no extra registration). The bridge `config.yaml` is generated at runtime and **gitignored**, so these live in SETUP.md, not the repo. ⚠️ **Backfill is non-retroactive** — only portals created *after* it is on get history; enable **before** linking accounts. **Restart needed:** Synapse recreate for the pin (`docker compose up -d synapse`); **bridge restart** after the config hand-edit. Not applied here — live WhatsApp session left running. |
| 11 | **Synapse DB bloat.** `state_groups_state` explodes with WhatsApp group join/leave churn (100K+ rows/room), degrading queries — worst on constrained IOPS (Oracle free tier). | Manual fix only | Recurring [`rust-synapse-compress-state`](https://github.com/matrix-org/rust-synapse-compress-state) job from day one; media retention policy for bridged media. |
| 11 · **DONE** | Infra-chores 2026-07 | ✅ Added [`infra/compress-state.ps1`](../infra/compress-state.ps1) — runs `synapse_auto_compressor` (from `ghcr.io/matrix-org/rust-synapse-compress-state`) against the `synapse` DB. | Reads `POSTGRES_USER`/`POSTGRES_PASSWORD` from `infra/.env` (nothing hardcoded); joins the compose network to reach `postgres` by hostname; passes the DSN via env so no secret hits a command line. **Safe while Synapse is up** (append-only tables, atomic txns) → no restart. Run **weekly** + after each new account link. Docs: SETUP.md → "Maintenance — compress Synapse state". Media-retention policy still TODO. |
| 12 | **Ban risk hygiene (WhatsApp).** Bans correlate with suspicious patterns (VoIP numbers, fresh accounts, cold-DMing), not bridge use per se. | Behavioral | Document guidance for users; don't automate outbound patterns that look bot-like. |
| 13 | **Background sync / notifications** — Beeper's biggest ongoing pain is mobile background delivery. Desktop (us, now) is easy; Tauri mobile later will hit push-gateway + OS background-limit work. | Future | Note now, design the notification path when mobile starts. |

## Build order

1. **Session A — sync lifecycle**: risks 1, 3 (+ state-reset tolerance groundwork from 9). Small, isolated, immediate reliability payoff.
2. **Session B — Timeline migration**: risks 2, 4, 6. Open-room live diffs + event cache; delete the 3 s poll.
3. **Session C — RoomListService inbox**: risk 5. Incremental inbox, kill the O(rooms) rescan.
4. **Infra chores** (parallel, config-only): risks 10, 11 — Synapse version pin, backfill/double-puppet config, compress-state cron.

After A–C land, the client's sync story is structurally the same as Element X's, on self-hosted
infra with bridge health visibility — that's the moment to start the UI/UX phase.
