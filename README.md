# beep-beep-oss

> An open-source, self-hostable universal chat client — all your messaging networks
> in one place, with **instant sync** and **no features locked behind a paywall**.

Built on [Matrix](https://matrix.org) and the [mautrix](https://github.com/mautrix)
bridge ecosystem, `beep-beep-oss` aims to be the chat aggregator that respects you:
your messages are never artificially delayed, your accounts are yours, and the core
is — and always will be — free software.

> **Working name.** `beep-beep-oss` is a placeholder; the project will be rebranded
> before any public release.

---

## Why this exists

Existing universal-chat apps gate basic functionality — including **how fast your
own messages sync** — behind subscription tiers. That's user-hostile. This project
takes the opposite stance:

- **No delay sync.** Self-hosting removes artificial throttling entirely; the client
  is tuned for instant, real-time delivery.
- **No paywalled core.** Every messaging feature in the open-source client is free.
- **Multi-account, first-class.** Run multiple accounts of the same network (e.g. two
  WhatsApp accounts) side by side.
- **Yours to host.** Run the whole stack yourself, or (eventually) use a managed
  hosted option — your choice, same client.

## What it is (and isn't)

This is **not** a new chat protocol. It's a curated, hardened, well-operated
assembly of proven open-source pieces, plus the parts that have been missing:
a fast native client, painless onboarding, and reliable bridge operations.

| Layer | Technology |
|-------|-----------|
| Homeserver | [Synapse](https://github.com/element-hq/synapse) (native Simplified Sliding Sync) |
| Sync | [Simplified Sliding Sync (MSC4186)](https://github.com/matrix-org/matrix-spec-proposals/pull/4186) |
| Bridges | [mautrix](https://github.com/mautrix) (`bridgev2`) — WhatsApp, Instagram, … |
| Client core | [matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk) (Rust) |
| Client app | [Tauri 2](https://tauri.app) + React/TypeScript (desktop **and** mobile) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and the
reasoning behind each decision.

## Supported networks (target)

| Network | Bridge | Status | Notes |
|---------|--------|--------|-------|
| WhatsApp | `mautrix-whatsapp` | Priority | Companion-device link (low ban risk); multi-account |
| Instagram | `mautrix-meta` | Planned | Self-host-only initially (higher account risk) |
| _more_ | mautrix family | Later | Signal, Telegram, Messenger, … |

## Project status

🚧 **Alpha — Phase 1 (client) in progress.** Phase 0 is proven: the self-hosted
stack (Synapse + `mautrix-whatsapp`) runs on real infrastructure with instant
sync and multi-account login. The native client (Tauri 2 + React +
matrix-rust-sdk, in [`client/`](client/)) is now working: login, a live unified
inbox with previews, search, and real avatars, two-way chat with optimistic
send, session persistence across restarts, and Simplified Sliding Sync.

➡️ **Want to run it?** The self-hosted stack (Synapse + WhatsApp bridge) lives in
[`infra/`](infra/), with a step-by-step in **[SETUP.md](SETUP.md)** — including a
fully free path on Oracle Cloud's Always Free tier. The client runs from
[`client/`](client/) with `npm install && npm run tauri dev`.

**Roadmap**

- **Phase 0 — Prove it** ✅: Synapse + `mautrix-whatsapp` + an existing
  sliding-sync client. Zero-delay sync and multi-account login confirmed.
- **Phase 1 — Client shell** (in progress): Tauri + React + matrix-rust-sdk.
  Live unified inbox, two-way chat, session persistence, sliding sync — done.
  Fast cold start and multi-account UI — next.
- **Phase 2 — Bridge ops:** reconnection, health monitoring, observability — the
  "non-buggy" promise.

## License

[AGPL-3.0](LICENSE). The open-source core is, and will remain, free software. The
network-copyleft of AGPL ensures that anyone who runs a modified version as a
service must share their changes — protecting the project from being quietly
absorbed into a closed product.
