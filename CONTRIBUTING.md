# Contributing to beep-beep-oss

Thanks for your interest! This project is early (pre-alpha, Phase 0). This guide sets
the basic norms so the codebase stays coherent as it grows.

> 📖 Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it explains *why* the
> project is built the way it is. Most "why don't we just…" questions are answered there.

## Project values (these are not negotiable)

1. **The client is, and stays, 100% open source and homeserver-agnostic.** It must work
   against any Matrix homeserver, not just ours.
2. **Sync speed is never throttled** — not in any tier, ever. Performance is a promise,
   not a product lever.
3. **Monetize operations, never features.** No user-facing feature is ever paywalled.

If a change conflicts with these, it won't be merged regardless of code quality.

## License & copyright (important)

- The project is licensed under **AGPL-3.0** (see [`LICENSE`](LICENSE)).
- By contributing, you agree your contributions are licensed under AGPL-3.0.
- A formal **Contributor License Agreement (CLA)** will be introduced before the project
  accepts substantial external contributions. The CLA lets the maintainer offer a
  managed/hosted version (the planned SaaS) while keeping the project open. This is the
  standard open-core arrangement (cf. Mastodon, GitLab). Until the CLA exists, large
  contributions may be held pending it — ask first for anything sizeable.

## Branching & commits

- Branch from `main`. Use short, descriptive branch names (`feat/...`, `fix/...`,
  `docs/...`).
- Commit messages follow **Conventional Commits**:
  `type(scope): summary` — e.g. `feat(client): add unified inbox` or
  `fix(infra): correct bridge appservice port`.
  Common types: `feat`, `fix`, `docs`, `refactor`, `chore`.
- Keep commits focused; explain *why* in the body when it isn't obvious.

## Running things locally

- **Phase 0 stack** (homeserver + WhatsApp bridge): see [`SETUP.md`](SETUP.md). The
  [`infra/Makefile`](infra/Makefile) wraps the common commands (`make help`).
- **Never commit secrets or generated state.** `.env`, `homeserver.yaml`,
  `registration.yaml`, signing keys, and `infra/data/` are all gitignored — keep it that
  way.

## Reporting issues

Open a GitHub issue with: what you did, what you expected, what happened, and (for the
stack) which path you're on (local vs Oracle/public) plus relevant `docker compose logs`.

## Code of conduct

Be decent. Assume good faith. We'll adopt a formal Code of Conduct as the community grows.
