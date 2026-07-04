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
- [x] ~~matrix-sdk bump 0.18 → latest~~ **Reality check (2026-07-05): 0.18.0
      IS the latest published release** — the `linked_chunk` panic fix exists
      only on unreleased git, and pinning git contradicts the latest-stable
      policy. Done instead: full `cargo update` within semver (tauri 2.11.5,
      rustls, quinn, …), bindings verified drift-free. Bump to 0.19 in the
      first bump-week after it ships (that's the SyncService/Timeline
      migration project).
- [ ] **linked_chunk panic plan** (upstream matrix-rust-sdk#5416 — same panic,
      open since Jul 2025, no fix exists anywhere; "wait for 0.19" is not a
      plan). Three layers:
      **Containment is the plan, not the fallback** — it defends the whole
      class (any cache-vs-server disagreement), not just this bug, on the
      principle *the cache is disposable, the server is truth*:
      1. [x] *Shipped 2026-07-05* (`src-tauri/src/panic_guard.rs`): chained
         panic hook → `<app_data>/panics.log` (+ "rust-panic" Tauri event,
         per-session counters); cache-class panics (linked_chunk/event_cache)
         → flag file → next launch wipes ONLY
         `matrix-sdk-event-cache.sqlite3` (crypto/state/media untouched).
         **Threshold corrected 2→1 (same day):** live evidence showed a SINGLE
         panic already poisons the cache (`InvalidItemIndex` on later ops) and
         silently freezes open-room timelines while the room list keeps
         updating — so any cache panic now schedules a wipe. Plus a
         **degraded-state banner** (usePanicGuard hook + DegradedBanner +
         restart_app command): a cache-class panic surfaces a "restart to
         refresh" banner, turning the otherwise-silent freeze into a
         one-click recovery (restart applies the wipe). Verified live: fresh
         cache → 0 panics / 0 corruption / inbox re-synced.
      2. [x] *Posted 2026-07-05:* reproduction recipe on #5416
         (matrix-rust-sdk#5416, comment 4883568902) — both triggers + offer
         to test candidate patches.
      3. *Contingency with a trigger, NOT a scheduled task:* SDK surgery
         (root-cause + upstream PR + temporary `[patch.crates-io]` fork) is
         justified ONLY if Gate G2 fails with containment in place — a
         crash-loop that survives a cache wipe. Rationale for not scheduling
         it: deep concurrent-invariant code where a wrong fix = silent
         ordering corruption (worse than a loud panic); time-boxes on
         year-old concurrency bugs rarely hold; 0.19's event-cache rework may
         obsolete any patch. If it ever triggers: weekly CI cron watching
         crates.io bounds the fork's frozen window.
      4. *Gate G2 before v1.0* (see Gates below) is the arbiter.
- [x] CI pipeline: gitleaks (full history, container invocation — the GH
      action needs a license for org repos), tsc + vite build, cargo
      check/test on windows-latest, ts-rs bindings-drift gate.
      Follow-up: release-build job producing installers (Phase 5).
- [ ] Close out remaining SYNC-HARDENING items not blocked on SDK 0.19.

### Phase 2 — Message parity (WhatsApp table stakes)
All data-layer first (bindings regen), UI is largely already built to receive:
- [x] **Replies rendering** (2026-07-05): `reply_to: ReplyPreview` on ChatLine
      from the Timeline's resolved in-reply-to details → quote block in bubbles.
- [x] **Reactions v2** (2026-07-05): `Vec<ReactionGroup>` {key, senders,
      reacted_by_me}; `toggle_reaction` through the open Timeline with the
      **WhatsApp one-reaction rule** (new emoji replaces your previous one;
      same emoji toggles off; applied globally — matches WA/Signal/TG and what
      bridged recipients see). Verified live incl. interactive toggle.
- [x] **Read ticks** (2026-07-05): `read_by_other` on ChatLine from Timeline
      read-receipts, suffix-folded; single check → oxblood double on read.
      Verified server-side (receipt on target event, own-receipt filtered).
      Note: WhatsApp's *delivered* (grey ✓✓) state isn't distinctly surfaced
      by the bridge/SDK yet — we show sent (✓) → read (✓✓). Revisit if the
      bridge exposes delivery separately.
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
      - **WhatsApp @usernames (future-proofing only, no build)**: usernames
        ride the LID + in-WA-contact-store architecture; support arrives via
        whatsmeow, not us. Keep the seam ready: NewChatModal input is a generic
        identifier field (validation in the per-network adapter — Telegram
        needs @handles at Phase 4 anyway), and the adapter error enum reserves
        "username not found" and "PIN required" variants. Revisit when the
        rollout leaves beta.
      - **Dispatch contact store**: user-assigned contact names live in Matrix
        account data (per-user, syncs to future devices, network-agnostic),
        with per-network write-through adapters: Telegram = real server-side
        add-contact (works now, appears on their phone); WhatsApp = spike
        whether whatsmeow exposes the new encrypted in-WA contact store
        (write-back if yes, Dispatch-only name if no — say so in the UI).
        Display precedence: Dispatch name → address book → push name → id.
        Phone OS address-book write-back: only possible from mobile; parked
        with the mobile track.

### Phase 2.5 — Timeline loading & history depth (dogfooding-driven)
Guiding constraint: **keep the current speed** (the thing that already feels
better than Beeper). Do NOT eager-load everything — load intelligently to a
depth chosen by measurement, not guesswork.
- [ ] **Performance matrix first**: measure open-latency, memory, and disk vs
      history depth and number of warmed rooms. The matrix decides the
      defaults below — no magic numbers.
- [ ] **(Layer 1) Cross-room timeline warming**: recent/important rooms open
      *instantly* (warm their timelines in the background by recency + unread +
      pinned), instead of building the Timeline only on click. SDK-limited on
      0.18 (no multi-room event-cache prefetch); revisit depth after 0.19.
- [ ] **(Layer 2) Within-room initial window + backfill**: load a larger
      initial window and background-backfill history to a sensible depth so
      "load older" isn't needed for conversations WhatsApp Desktop shows fine.
      Distinct from Layer 1 (this is depth *inside* the open room; Layer 1 is
      *which* rooms are ready). Both bounded by the perf matrix.
- [ ] **Degraded-recovery rework** (replaces the restart-prompt banner from the
      2026-07-05 containment fix — bad UX mid-typing): (a) **persist composer
      drafts** so no recovery ever loses typing; (b) attempt **in-place
      open-room Timeline rebuild** on detected staleness instead of a restart;
      (c) only if that fails, a **passive, dismissible** notice — never a
      modal restart demand.
- [ ] **Verify bridge read-ticks** (Phase-2 carryover): real 2-person WhatsApp
      chat test to confirm mautrix maps WhatsApp delivered/read → Matrix
      receipts, so `read_by_other` double-ticks actually light up on bridged
      chats (self-chat has no "other", so it can't validate this).

### Phase 3 — Daily-driver polish
- [ ] Taskbar unread badge + tray presence.
- [ ] Notification click-to-open-room (Windows COM activation on the AUMID
      registered in Phase 7 of the redesign).
- [ ] Per-room drafts that survive switching; mark-as-unread.
- [ ] Link previews.
- [ ] Settings → Storage: per-store sizes (media / event cache / state /
      crypto) + "Clear caches" button reusing the panic-guard wipe path
      (event cache + media only — crypto is E2EE keys and must never be
      cleared). Context: media self-cleans (0.18 MediaRetentionPolicy
      defaults: 400 MiB cap / 20 MiB per file / 60-day expiry); event cache
      has NO retention knobs in 0.18 (tiny in practice; revisit at 0.19).

### Phase 4 — Second network: Telegram
- [ ] mautrix-telegram service in compose; provisioning UX on the Phase-2 seam.
- [ ] Login flow is code+password (not QR) — `start_login(network)` must
      support both flow shapes; onboarding step-2 generalizes.
- [ ] Rail/account model already multi-network; per-network colors exist in the
      token set.

### Phase 5 — OSS launch
- [ ] **Fresh-install onboarding gap** (found in the 2026-07-05 nuke rehearsal):
      the app's WhatsApp-link step looks for an *existing* bridge-bot DM, but a
      clean install has none — so onboarding can't initiate the QR flow
      unassisted (had to create the admin↔@whatsappbot DM via API). The
      onboarding must create that DM itself (invite the bot / start the chat)
      before sending the login command. Direct Gate-G1 blocker.
- [ ] Admin-user registration from the app's first-run wizard (today it's a
      manual `register_new_matrix_user` — a stranger can't do that from docs
      alone in <30 min).
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
- **Calls** — three-lane plan, honesty first (bridges relay store-and-forward
  messages; realtime E2E call media cannot be bridged — WhatsApp/Telegram call
  audio/video will NEVER flow through Dispatch, and we say so):
  1. **Signaling relay** (small, fits Phase 3): enable the bridge's
     `call_start_notices`, render those notice events as a ringing notification
     ("X is calling on WhatsApp — answer on your phone") + cross-network call
     history in the Calls surface (missed in red, per spec).
  1.5 **Call-link reply** (small, pairs with 1): one-click reply to a ringing
     call with an **Element Call guest link** — the caller opens it in their
     phone browser, no app install, E2EE media. Uses the public
     call.element.io instance at first (settings toggle + honest docs note
     that the SFU relay is third-party); self-hosted RTC becomes the later
     privacy upgrade. Also gives the spec's "Create call link" card a real
     backend. Quiet escape hatch alongside it: "Open in WhatsApp Desktop"
     deep-link (`whatsapp://send?phone=…`) for users who run the official
     desktop app as a second linked device.
  2. **Matrix-native / self-hosted RTC** (post-v1.0, rides behind mobile):
     coturn (+ optionally Element Call/LiveKit as a compose profile) so lane
     1.5 stops depending on public infra; `m.call.*` 1:1 in the webview
     (WebView2 supports WebRTC).
  3. **Group calls via MatrixRTC** — only on user demand; an SFU fights the
     20-minute-setup cut-line.
  - **Never**: third-party WhatsApp call APIs (green-api-style cloud sessions)
    — they hand the user's session to a third party, destroy the privacy
    story, and are the highest-ban-risk pattern. Not even as a plugin.
  - **Watch-item (6-month cadence)**: EU DMA interop — Meta is required to
    open WhatsApp messaging interop now and call interop on the regulation's
    later timeline (~2027). The only path to *sanctioned* WhatsApp calls in a
    third-party client; if it matures, the hosted tier (Phase 6) is the entity
    positioned to use it. Ref: matrix-org/dma-demo-app-bridge-whatsapp.

## v1.0 Gates

Gates are blocking pass/fail tests tied to specific accepted risks — run
before the release is allowed to ship. To-dos build the product; gates
interrogate it.

- **G1 — Stranger test** (setup-UX risk): a stranger on Windows gets
  WhatsApp-in-Dispatch in <30 min without editing a config file.
- **G2 — Update-path resilience** (linked_chunk panic risk): with a populated
  event cache and panic telemetry on, recreate the Synapse container 5×
  (= the self-hoster's `compose pull && up -d` routine, our known panic
  trigger). Every run: sync self-heals to running without app restart; **open
  a conversation and confirm its timeline shows the latest messages** — NOT
  just that the room-list preview is current (the 2026-07-05 bug: room list
  updated while the open timeline stayed frozen, because they use different
  data paths); a cache-class panic must raise the degraded banner; restart
  must wipe + recover with no data loss (timeline spot-check vs a second
  client); no duplicated/reordered messages; no crash-loop.
- **G3 — Secret hygiene** (already automated): full-history gitleaks green in
  CI + manual pass at launch.

## Engineering invariants (never violate)

- **Bridge commands go only to identity-verified rooms.** Never resolve the
  bridge bot (or any command target) by fuzzy display-name matching or any
  signal that can change under room-list churn. Resolve by mxid, and
  HARD-ASSERT the room's active members are a subset of the expected set
  before sending. Rationale: the 2026-07-04 incident — client-side fuzzy
  bot-room matching re-fired "login qr" into ~9 rooms including real contacts
  during a portal-import storm, getting a WhatsApp account banned. See
  `whatsapp_start_login` in matrix.rs. This class of "the app messaged a real
  person on its own" bug is release-blocking, always.
- **A gate for it (add to v1.0 G-set):** after triggering WhatsApp login, DB-
  assert that every `login qr` (and any bridge command) message lands ONLY in
  the bot DM, across a fresh-account portal import.

## Known risks (carry-forward)
- matrix-sdk 0.x churn (mitigated by bump cadence + CI).
- WhatsApp ToS / ban risk — personal-use disclaimer for OSS; the real exposure
  question is hosted (Phase 6).
- E2EE debt: single-device works today; multi-device requires cross-signing
  work before mobile.
- SDK event-cache panic (`linked_chunk`) on 0.18: recovery loop self-heals, but
  the bump is the fix.
