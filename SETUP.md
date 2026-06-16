# Phase 0 — Setup Guide

> **Goal:** stand up a Matrix homeserver + WhatsApp bridge and *prove the thesis* —
> instant (no-delay) sync and multiple WhatsApp accounts at once.
>
> There are two paths. Do **Local** first (free, 10 minutes, no signup), then graduate
> to **Oracle Free** when you want it always-on and reachable from your phone.

---

## 0. Prerequisites

- **Docker** + the **Docker Compose plugin**.
  - Local (Mac/Windows): install *Docker Desktop*.
  - Linux/Oracle: install Docker Engine, then verify `docker compose version` works.
- ~2 GB RAM free. (Oracle's free Ampere A1 gives you up to 24 GB — plenty.)

Everything below runs from the `infra/` directory:

```bash
git clone https://github.com/capad-xyz/beep-beep-oss.git
cd beep-beep-oss/infra
cp .env.example .env
```

Now edit `.env` (see comments inside it). Set at least:
- `SERVER_NAME` → `localhost` (Local path) or your domain (Oracle path)
- `POSTGRES_PASSWORD` → a long random string: `openssl rand -hex 24`

---

## 1. Generate the Synapse config

Synapse writes its own initial config on first run:

```bash
docker compose run --rm synapse generate
```

This creates `./data/synapse/homeserver.yaml` and a signing key. Now open
`./data/synapse/homeserver.yaml` and make **two edits**:

**(a) Point Synapse at Postgres** — replace the default `database:` block with:

```yaml
database:
  name: psycopg2
  args:
    user: beep                 # = POSTGRES_USER
    password: YOUR_PASSWORD     # = POSTGRES_PASSWORD from .env
    dbname: synapse
    host: postgres             # the docker service name
    port: 5432
    cp_min: 5
    cp_max: 10
```

**(b) Tell Synapse to load the bridge** — add this near the top level:

```yaml
app_service_config_files:
  - /data/whatsapp-registration.yaml
```

> 💡 You do **not** need to enable Sliding Sync. As of current Synapse, Simplified
> Sliding Sync (the "no-delay" engine) is **on by default**.

---

## 2. Generate the WhatsApp bridge config + registration

**First run — generates the config:**

```bash
docker compose run --rm mautrix-whatsapp
```

It writes `./data/mautrix-whatsapp/config.yaml` and exits. Edit these fields:

```yaml
homeserver:
  address: http://synapse:8008      # talk to Synapse over the docker network
  domain: localhost                 # = SERVER_NAME

appservice:
  address: http://mautrix-whatsapp:29318
  hostname: 0.0.0.0
  port: 29318

database:
  type: postgres
  uri: postgres://beep:YOUR_PASSWORD@postgres/mautrix_whatsapp?sslmode=disable

# Who may use the bridge. Replace with YOUR matrix ID + domain.
permissions:
  "localhost": user                 # = SERVER_NAME; anyone on this server can use it
  "@you:localhost": admin           # your full user ID gets admin
```

**Second run — generates the registration file** (Synapse needs this to trust the
bridge):

```bash
docker compose run --rm mautrix-whatsapp
```

When it prints that it generated the registration and starts up, press **Ctrl-C**.
You now have `./data/mautrix-whatsapp/registration.yaml`.

**Wire it into Synapse** — Synapse looks for it at `/data/whatsapp-registration.yaml`
inside its own container, so copy it across:

```bash
cp ./data/mautrix-whatsapp/registration.yaml ./data/synapse/whatsapp-registration.yaml
```

> ⚠️ If you ever regenerate the registration, copy it across again and restart Synapse.

---

## 3. Bring the stack up

**Local path:**

```bash
docker compose up -d
docker compose logs -f synapse        # watch it come up; Ctrl-C to stop watching
```

**Oracle / public path** (adds the TLS proxy — see §6 first for DNS/firewall):

```bash
cp caddy/Caddyfile.example caddy/Caddyfile
docker compose --profile public up -d
```

---

## 4. Create your Matrix user

```bash
docker compose exec synapse \
  register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008
```

Pick the username you used in the bridge `permissions` (e.g. `you`), make it an admin
when asked. Your full ID is `@you:SERVER_NAME`.

---

## 5. Connect WhatsApp & verify the thesis

1. **Open a Matrix client** pointed at your homeserver:
   - Local: *Element Desktop* → custom homeserver `http://localhost:8008`.
   - Public: *Element X* (mobile) or `app.element.io` → `https://SERVER_NAME`.
2. **Start a chat with the bridge bot:** `@whatsappbot:SERVER_NAME`.
3. Send `login`. The bot replies with a **QR code** (or pairing code).
4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device** → scan it.
5. Your WhatsApp chats appear in Matrix. ✅

**Prove "no delay":** send yourself a WhatsApp message from your phone and watch it land
in the Matrix client effectively instantly.

**Prove multi-account:** run `login` again in the bot chat and link a *second* WhatsApp
account. Both sets of chats should coexist — that's the bridgev2 multi-login model, and
the core requirement validated.

---

## 6. Oracle Cloud "Always Free" specifics

- **Instance:** Ampere A1 (ARM), e.g. 2 OCPU / 12 GB. All images here are arm64-ready.
- **Firewall (two layers):**
  - Oracle *Security List / NSG*: allow inbound TCP **80** and **443**.
  - The instance OS firewall (often `iptables`/`firewalld`): open 80/443 too.
- **Domain for free:** create a subdomain at [DuckDNS](https://www.duckdns.org) pointing
  to your instance's public IP, and set `SERVER_NAME=yourname.duckdns.org` in `.env`.
- **TLS for free:** the `caddy` service auto-fetches a Let's Encrypt cert for
  `SERVER_NAME` once 80/443 are reachable. No manual cert steps.

---

## Troubleshooting

- **Synapse won't start, complains about collation** → the Postgres DB wasn't created
  with `LC_COLLATE='C'`. Wipe `./data/postgres` and let `init-databases.sh` recreate it.
- **Bridge bot never responds** → Synapse didn't load the registration. Confirm
  `app_service_config_files` points at the copied file and restart Synapse.
- **Can't reach Synapse from a browser on Local** → use `http://localhost:8008`, and
  remember `SYNAPSE_BIND` defaults to `127.0.0.1` (same machine only).
- **Caddy can't get a cert** → DNS for `SERVER_NAME` must resolve to this server and
  ports 80/443 must be open at *both* firewall layers.

---

## What's next (Phase 1)

Once instant sync + dual WhatsApp are proven here, we build the client:
**Tauri 2 + React + matrix-rust-sdk** — see `docs/ARCHITECTURE.md`.
