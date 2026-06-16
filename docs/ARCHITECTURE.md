# Architecture & Design Decisions

This document captures the decisions behind `beep-beep-oss` and *why* each was made.
It is the source of truth for the project's direction. Decisions here were made
deliberately; revisit them only with new information, not on a whim.

## 1. Guiding principles

1. **No artificial delay.** Sync latency is an engineering target, never a monetization
   lever. The free, self-hosted experience is the *fast* experience.
2. **No paywalled core.** Every messaging capability in the client is open and free.
3. **Don't reinvent the protocol.** Matrix and the mautrix bridges are mature and
   open. Our value is the client UX, onboarding, and bridge operations — not a new
   network.
4. **Self-host first, SaaS optional.** The client must work against *any* homeserver.
   A managed offering is additive, never a gate.

## 2. The stack

| Concern | Choice | Why |
|---------|--------|-----|
| Homeserver | **Synapse** | Mature, native Simplified Sliding Sync (since 1.114), best bridge compatibility, sync code rewritten in early 2026 for performance. |
| Sync transport | **Simplified Sliding Sync (MSC4186)** | Streams only in-view rooms incrementally; the modern, supported "instant sync" path. Proxy is sunset — this is native now. |
| Bridges | **mautrix (`bridgev2`)** | Best-in-class, open source, actively maintained. `bridgev2` models multiple logins per user as a first-class concept. |
| Client core | **matrix-rust-sdk** | Native performance, shared core across all platforms, official sliding-sync support (same approach as Element X). |
| Client app | **Tauri 2 + React/TypeScript** | Rust backend + web frontend with a typed IPC bridge; ~96% smaller and ~50% less RAM than Electron, and compiles to desktop **and** mobile (iOS/Android) from one codebase. |

### Why not alternatives

- **conduwuit / Tuwunel homeserver:** Tuwunel (conduwuit's Rust successor) is fast and
  appealing, but bridge compatibility and documentation are thinner. Keep as a
  *performance option to benchmark later*; start on Synapse.
- **Electron client:** heavier, and cannot target mobile. Tauri wins on both bloat and
  reach.
- **Pure-JS client (matrix-js-sdk):** faster to prototype, but loses the native speed
  that underpins the "non-buggy, no-delay" promise. Rust core is the differentiator.

## 3. The cross-language boundary (Rust ↔ TypeScript)

The Rust core exposes a clean command surface (e.g. `send_message`, `get_rooms`,
`subscribe_sync`) to the React frontend via **Tauri's typed IPC** (`invoke()`).

**Type drift mitigation:** Rust structs and TS types can silently diverge. We generate
TypeScript types from Rust structs at build time (`ts-rs` or `specta`) so the boundary
stays in sync automatically. Set up once, on day one.

**Escape hatch:** if the Rust UI integration ever becomes a maintenance burden, the
boundary can move — keep only sync/core in Rust and push more logic to TypeScript.
We are not locked in.

## 4. Multi-account model

"Two WhatsApp accounts" is a **first-class requirement**, not a bolt-on. The entire
app — identity, unified inbox, notifications, settings — treats **N accounts per
network** as the default.

- **Design ceiling for v1:** up to **2 accounts per network**. Data model should not
  *hardcode* 2, but UX and testing target this.
- mautrix `bridgev2` supports multiple logins per Matrix user (`user_login` table).
  The exact login UX must be verified hands-on in Phase 0 before the data model is
  frozen.

## 5. Network support & risk posture

| Network | Bridge | Risk | Decision |
|---------|--------|------|----------|
| WhatsApp | `mautrix-whatsapp` (whatsmeow) | **Low** — links as an official companion device | Priority network; first-class in OSS + SaaS. |
| Instagram | `mautrix-meta` | **Moderate** — unofficial API; Meta runs periodic ban waves | **First-class network** (OSS + SaaS), built normally with full features. Surface honest history/risk warnings to users. Apply sensible rate-limiting, but do not treat as second-class — Beeper ships Instagram, and so do we. |

## 6. Push notifications (a known self-host pain point)

Instant sync is undermined if notifications lag. This is explicitly in scope.

- **Android:** Sygnal push gateway + UnifiedPush (ntfy / Sunup). Self-hostable.
- **iOS:** must route through Apple's APNs — requires our own push gateway with Apple
  certificates. Unavoidable.
- **Strategy:** managed, reliable, all-platform push is a strong **SaaS value-add**,
  since self-hosters consistently struggle with it.

## 7. OSS / SaaS boundary

**Guiding principle: monetize the *operational burden*, never the *features*.** The
software is fully free and the client works against any homeserver. Revenue comes from
running the 24/7 infrastructure, not from unlocking capabilities.

**Two non-negotiable rules (they define the brand):**
1. The client is 100% OSS and homeserver-agnostic, forever.
2. **Sync speed is never throttled — not even on a free SaaS tier.** If a free tier
   ever needs limits, cap *number of bridges* or *retention*, never *speed*.

**The boundary:**

| Capability | OSS (AGPL-3.0) | SaaS (paid) |
|---|---|---|
| Client app (desktop + mobile) | ✅ always | same app, points at our servers |
| Self-host docs + docker-compose | ✅ | — |
| Bridges (mautrix) | ✅ (already AGPL) | run for the user |
| Homeserver | ✅ DIY | ✅ managed: backups, uptime, updates |
| Push notifications | ✅ DIY (Sygnal/UnifiedPush) | ✅ reliable all-platform incl. iOS APNs |
| Instagram | ✅ first-class | ✅ first-class |
| iMessage relay | — | ✅ SaaS-only (needs Mac infra) |
| **Functional** bridge-ops dashboard | ✅ self-hosters get a real, working dashboard | — |
| **Multi-tenant / billing / fleet-scale ops** layer | — | ✅ proprietary (the moat) |

**Open-core line (resolved):** Everything an *individual self-hoster* needs is open —
including a fully functional bridge-management/health dashboard. Only the code that
exists *purely to operate a hosting business at scale* (multi-tenancy, billing,
fleet observability, auto-scaling) is proprietary. No *user-facing feature* is ever
closed. This mirrors Mastodon / GitLab CE-EE / Element.

**Pricing / free-tier:** deferred. Only fixed constraint: speed is never the lever.

- **Licensing for dual model:** retain copyright ownership (contributor license
  agreement / CLA) so the managed/proprietary layer can be offered. Decide CLA setup
  before the first external contributor.

## 8. Roadmap

- **Phase 0 — Prove it.** Synapse + `mautrix-whatsapp` + an existing sliding-sync
  client (e.g. Element X). Validate: zero-delay sync, multi-account WhatsApp login.
  *Exit criteria:* measurably instant sync; two WhatsApp accounts visible at once.
- **Phase 1 — Client shell.** Tauri + React + matrix-rust-sdk. Unified inbox, fast
  cold start, multi-account UI, type-safe Rust↔TS boundary.
- **Phase 2 — Bridge ops.** Reconnection, health monitoring, observability, companion
  -device expiry handling. The "non-buggy" promise lives here.

## 9. Open questions

- Exact multi-login UX in current `mautrix-whatsapp` (`bridgev2`) — verify in Phase 0.
- SaaS pricing / free-tier shape (deferred; speed never throttled).
- CLA tooling and process.
- Synapse vs Tuwunel benchmark once load matters.
