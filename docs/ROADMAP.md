# Dispatch — Roadmap to Launch

> Status: agreed 2026-07-04 (post UI-redesign verification). Owner: capad.io.
> This is the working plan, not a promise — reorder as reality dictates, but
> record the reordering here.

## What "launch" means

1. **v1.0 = OSS self-host release** (this repo goes public). The deliverable is
   the *20-minute setup*: one `docker compose up`, a first-run wizard that
   registers the admin user and walks the WhatsApp QR link, signed installers,
   auto-updater, docs. **Cut-line test: a stranger on Windows gets
   WhatsApp-in-Dispatch in under 30 minutes without editing a config file.**
2. **Hosted tier comes after OSS traction** — the *same artifact*, provisioned
   automatically as one isolated stack (Synapse + bridges + postgres) per
   tenant. Not a second architecture. Per-tenant isolation keeps WhatsApp-ban
   blast radius and data isolation clean; revisit lighter homeservers
   (conduwuit-class) only when hosted margins matter.
3. **License: AGPL-3.0** — forced by mautrix (AGPL) and correct anyway: no one
   can host modified Dispatch closed-source. The hosted tier's moat is
   operations (provisioning, upgrades, bridge-health, support), not the code.

No hard launch date. Near-term milestone target (~2 weeks, sem break):
**Milestone "Daily Driver"** = Phase 1 + the core of Phase 2 below — the point
where this replaces Beeper day-to-day. Launch itself ships when the cut-line
test passes; 6 months is acceptable.

## Stack currency policy

- Pin exact versions; **monthly "bump week"**, never mid-feature.
- matrix-sdk is 0.x (no stable): bump to latest **first** (Phase 1) — it
  retires the known `linked_chunk` event-cache panic and the parity work gets
  easier on the newer Timeline API.
- CI (GitHub Actions: `tsc`, `vite build`, `cargo check/test`, gitleaks) is a
  prerequisite for the bump cadence and for going public.

## Phases

### Phase 1 — Foundations
- [ ] matrix-sdk / matrix-sdk-ui bump 0.18 → latest (migration project; expect
      SyncService/Timeline API breaks). Retires the `linked_chunk` panic.
- [ ] CI pipeline: typecheck + frontend build + cargo check/test + gitleaks on
      every push. Release-build job producing installers as artifacts.
- [ ] Close out remaining SYNC-HARDENING items invalidated/fixed by the bump.

### Phase 2 — Message parity (WhatsApp table stakes)
All data-layer first (bindings regen), UI is largely already built to receive:
- [ ] **Replies rendering**: `in_reply_to` metadata on ChatLine → quote block in
      bubbles (UI exists, dark today).
- [ ] **Reactions v2**: `(key, sender, own)` — who reacted + toggle own off.
- [ ] **Delivery/read ticks**: sent → delivered → read mapped from Matrix
      receipts / bridge ticks.
- [ ] **Voice notes**: playback first (audio element + waveform-lite), recording
      second.
- [ ] **Media completion**: video/file rendering, click-to-fullscreen image
      viewer, download action.
- [ ] **New DM + contacts** via mautrix **provisioning API** (network-agnostic
      seam from day one: `resolve_contact(network, id)`, `start_dm(network,
      id)`; per-bridge adapter behind it). NewChatModal gains: Contacts tab
      (synced WA contacts), phone-number entry with resolve+confirm, Matrix
      mxid tab. Fallback plan B: bridge-bot `pm` command.
      - **Identity rules (LID era)**: ghost mxids are opaque — never parse
        phone numbers out of them; names come from contact/push-name data;
        numbers shown only when the bridge discloses them; all number entry
        flows through `resolve_identifier`. LID↔PN merging is upstream's job
        (one more reason to stay on current bridge versions).
      - **Dispatch contact store**: user-assigned contact names live in Matrix
        account data (per-user, syncs to future devices, network-agnostic),
        with per-network write-through adapters: Telegram = real server-side
        add-contact (works now, appears on their phone); WhatsApp = spike
        whether whatsmeow exposes the new encrypted in-WA contact store
        (write-back if yes, Dispatch-only name if no — say so in the UI).
        Display precedence: Dispatch name → address book → push name → id.
        Phone OS address-book write-back: only possible from mobile; parked
        with the mobile track.

### Phase 3 — Daily-driver polish
- [ ] Taskbar unread badge + tray presence.
- [ ] Notification click-to-open-room (Windows COM activation on the AUMID
      registered in Phase 7 of the redesign).
- [ ] Per-room drafts that survive switching; mark-as-unread.
- [ ] Link previews.

### Phase 4 — Second network: Telegram
- [ ] mautrix-telegram service in compose; provisioning UX on the Phase-2 seam.
- [ ] Login flow is code+password (not QR) — `start_login(network)` must
      support both flow shapes; onboarding step-2 generalizes.
- [ ] Rail/account model already multi-network; per-network colors exist in the
      token set.

### Phase 5 — OSS launch
- [ ] Packaging: NSIS/MSI installer, tauri-updater, code-signing cert.
- [ ] One-command compose + first-run wizard hardening (register admin from the
      app, no manual `register-user`).
- [ ] Docs: README with screenshots, SETUP rewrite against the wizard,
      RUNBOOK, SECURITY.md, issue templates.
- [ ] **Pre-public audit**: gitleaks full-history pass (pattern-grep came back
      clean 2026-07-04; `infra/data/`+`.env` never committed); prune
      `docs/design/**/screenshots/` of any real-chat captures
      (`dispatch-current.png` suspect); trademark sanity check on the
      "Dispatch" name.
- [ ] Repo goes public **with history intact** (41+ commits of narrative is
      credibility; no clean-room cut needed).

### Phase 6 — Hosted tier (after OSS traction)
- [ ] Automated stack-per-tenant provisioning of the same compose artifacts.
- [ ] WhatsApp ToS posture: per-tenant isolation, no shared egress, explicit
      disclaimers. AGPL obligations: publish any server-side modifications.
- [ ] Pricing covers infra + ops margin; homeserver-cost re-evaluation here.

## Parked (deliberately)
- **Mobile** (Tauri iOS/Android; Dispatch mobile specs already drawn) — re-enters
  after Phase 5; drags E2EE/cross-signing + key backup with it (second device
  makes encryption real).
- **AI layer** (code exists, uncommitted) — revisit post-launch.
- **Calls** — UI stub ships; no backend until Matrix VoIP (WhatsApp calls can't
  bridge).

## Known risks (carry-forward)
- matrix-sdk 0.x churn (mitigated by bump cadence + CI).
- WhatsApp ToS / ban risk — personal-use disclaimer for OSS; the real exposure
  question is hosted (Phase 6).
- E2EE debt: single-device works today; multi-device requires cross-signing
  work before mobile.
- SDK event-cache panic (`linked_chunk`) on 0.18: recovery loop self-heals, but
  the bump is the fix.
