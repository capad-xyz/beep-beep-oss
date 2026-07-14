# Deploying Dooper's homeserver to a VPS (Oracle Free Tier)

This is the production runbook for moving the stack from `localhost` to
**`dooper.capad.fyi`**. It assumes the local Phase 0 stack already works
(see [SETUP.md](../SETUP.md)) and explains *why* each step exists, not just
what to type.

> **The one unchangeable decision.** A Matrix `server_name` is baked into
> every user ID and event signature. Once this server mints
> `@you:dooper.capad.fyi`, that name can never change without starting over.
> The local stack's data (`@admin:localhost`) **cannot migrate** — the VPS is
> a fresh homeserver on purpose, and local stays as your dev environment.

---

## 0. What you're building

```
phone / laptop (Dooper app)
        │  https://dooper.capad.fyi  (443, TLS by Caddy)
        ▼
┌─ VPS (Oracle A1, Ubuntu, arm64) ────────────────────────────┐
│  caddy ──► synapse ──► postgres                             │
│              ▲                                              │
│              └── mautrix-whatsapp   ← NOT started until the │
│                  (internal only)      WhatsApp account is   │
│                                       confirmed clean       │
└─────────────────────────────────────────────────────────────┘
```

Same `infra/docker-compose.yml` as local — the `public` profile adds Caddy.
All images are multi-arch, so Oracle's free ARM machines run them unchanged.

## 1. Prerequisites (owner tasks)

- **DNS**: an `A` record `dooper.capad.fyi → <VPS public IP>`. TTL 300 while
  setting up. (Caddy's certificate fetch fails until this resolves — do DNS
  first, everything else can retry.)
- **Oracle instance**: VM.Standard.A1.Flex, 2 OCPU / 12 GB is plenty
  (4/24 if capacity allows — it's free either way). Ubuntu 22.04+ image.
  Free-tier ARM capacity varies by region; retry or script it if "out of
  capacity".
- **SSH key**: Oracle only does key auth by default — keep it that way.

## 2. Open the firewall — in BOTH places

Oracle traffic passes two firewalls; forgetting one is the classic
"DNS is right but the site times out" trap:

1. **OCI Console** → the VCN's Security List / NSG: allow inbound TCP `80`,
   `443` (and `443/udp` for HTTP/3, optional) from `0.0.0.0/0`.
2. **On the instance** (Ubuntu images ship restrictive iptables):
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
   ```

Port 22 stays open to your IP only if you want to be strict. Nothing else is
ever exposed: Synapse binds `127.0.0.1` on the host, Postgres and the bridge
live on the internal Docker network.

## 3. Install Docker + fetch the repo

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/capad-xyz/beep-beep-oss.git && cd beep-beep-oss/infra
```

## 4. Configure

```bash
cp .env.example .env        # then edit:
#   SERVER_NAME=dooper.capad.fyi
#   POSTGRES_PASSWORD=<long random>
cp caddy/Caddyfile.example caddy/Caddyfile
```

Generate Synapse's config (once):

```bash
docker compose run --rm synapse generate
```

Then harden `data/synapse/homeserver.yaml` — verify/add:

```yaml
enable_registration: false      # nobody but you creates accounts
report_stats: false
```

Registration stays closed; accounts are created explicitly (step 6).

## 5. First boot — WITHOUT the bridge

The WhatsApp bridge must not start until the account under review is clean
(and even then, linking happens deliberately, from the app). Start only the
core services by name:

```bash
docker compose --profile public up -d postgres synapse caddy
```

Watch Caddy obtain the certificate (`docker compose logs -f caddy`) — once DNS
resolves, this is fully automatic. Test from anywhere:

```bash
curl https://dooper.capad.fyi/_matrix/client/versions
```

JSON back = the homeserver is live on the public internet with TLS.

## 6. Create your account

```bash
docker compose exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml -u <yourname> -p '<password>' -a http://localhost:8008
```

`-a` makes it a server admin. Log in from Dooper with homeserver
`https://dooper.capad.fyi`.

## 7. Backups — the two things that cannot be recreated

Everything else is reproducible from this repo. These two are not:

1. **`data/synapse/<server_name>.signing.key`** — the server's cryptographic
   identity. Lose it and every device/session breaks permanently. Copy it
   off-box **once, now** (it never changes).
2. **Postgres** — all messages, accounts, bridge state. Nightly dump:
   ```bash
   # /etc/cron.daily/dooper-backup (chmod +x)
   #!/bin/sh
   cd /home/ubuntu/beep-beep-oss/infra
   docker compose exec -T postgres pg_dumpall -U beep | gzip \
     > /home/ubuntu/backups/dooper-$(date +%F).sql.gz
   find /home/ubuntu/backups -name 'dooper-*.sql.gz' -mtime +14 -delete
   ```
   Sync `~/backups` somewhere off the VPS (rclone to any cloud drive).

Also schedule the weekly state compactor (see SETUP.md "Maintenance") as a
cron on the box — Oracle free-tier IOPS make it matter more, not less.

## 8. Later — when the WhatsApp account is clean

1. Flip `WHATSAPP_LOGIN_PAUSED` to `false` in `client/src-tauri/src/matrix.rs`.
2. On the VPS: generate the bridge config/registration exactly as in
   SETUP.md §2 (config's homeserver address is `http://synapse:8008`,
   domain `dooper.capad.fyi`), wire the registration into Synapse, then:
   ```bash
   docker compose --profile public up -d mautrix-whatsapp
   ```
3. Link WhatsApp **once**, from the app, via Settings → Add network →
   "Show QR code" — its permanent home. The one-reaction rule, identity
   assertions, and the login-qr fix all apply as on local.

## Sizing reality check

Synapse + Postgres + one bridge for a handful of users idles around
1–1.5 GB RAM and negligible CPU; WhatsApp backfill bursts are the only
load spikes. 2 OCPU / 12 GB has ample headroom for Telegram-bridge-next
and a few friends' accounts.
