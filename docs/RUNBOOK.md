# Beeper OSS — Dev Loop Runbook

Practical steps for running, rebuilding, and troubleshooting the stack + client on
Windows. All commands verified against this repo (`infra/Makefile`, real ports, the
dev-loop gotchas). Paths use Git Bash syntax where shown.

---

## 1. Start Docker + the backend stack

The backend is 4 containers (postgres, synapse, mautrix-whatsapp, caddy) driven by a
Makefile in `infra/`.

```bash
# a) Start Docker Desktop and wait for the whale icon to go steady:
"/c/Program Files/Docker/Docker/Docker Desktop.exe" &

# b) Confirm the engine is up (hangs/errors until the VM is booted):
docker info            # or: docker ps

# c) Bring up the stack (from repo root):
cd infra
make up                # = docker compose up -d
make ps                # container status
make logs              # tail all logs (Ctrl-C to stop)
```

Synapse is reachable at **`http://localhost:18008`** (host 18008 → container 8008, set
by `SYNAPSE_BIND` in `infra/.env`). That's why the app's default homeserver is
`localhost:18008`.

Other Makefile targets: `make down` (stop), `make restart-synapse`, `make register-user`,
`make nuke` (wipe volumes — destructive).

---

## 2. Run / rebuild the app

```bash
cd client
npm run tauri dev      # Vite + Rust; opens the beep-beep window
```

- **Frontend edits** (`.tsx`, `.css`) → **hot-reload automatically**, no restart.
- **Rust edits** (`src-tauri/*.rs`, `Cargo.toml`, `tauri.conf.json`, capabilities) →
  **must relaunch** (the watcher misses some writes):
  ```bash
  taskkill //F //IM beep-beep.exe      # or: Stop-Process -Name beep-beep -Force
  cd client && npm run tauri dev
  ```

Fast checks without launching the app:

```bash
cd client && npx tsc --noEmit          # TypeScript type-check
cd client && npx vite build            # full frontend build
cd client/src-tauri && cargo check     # Rust compile-check (faster than a run)
```

Regenerate TS bindings after changing a Rust `#[derive(TS)]` struct:
`cd client/src-tauri && cargo test --lib` (stop `tauri dev` first — concurrent builds
fight over the linker lock).

---

## 3. Common errors → fixes

| Symptom | Cause | Fix |
|---|---|---|
| `An unexpected error occurred… initializing Inference manager / Secrets Engine: remove ….sock: file cannot be accessed` | Docker Desktop's stale unix-socket reparse-points (the space in the Windows username breaks the path; a prior crashed start left a socket that blocks the next start) | Kill all docker procs, then **rename** the socket dirs aside (delete won't work): `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` → `*.stale.<rand>`. Docker recreates them fresh and binds cleanly. **Never rename `%LOCALAPPDATA%\Docker` itself** — the volumes/vhdx live there. Note: `"EnableInference": false` in settings does NOT prevent this in Docker 4.78. |
| `Failed to attach disk …ext4.vhdx to WSL2: path not found` | Hyper-V compute service wedged after socket renames | Reboot (or admin `Restart-Service vmcompute`). |
| App build: `linker cannot open beep-beep.exe` / `EBUSY` | Old `beep-beep.exe` still running, or Defender scanning it | `taskkill //F //IM beep-beep.exe`; Defender exclusion already added for the target dir. |
| DB errors: `database "synapse" does not exist`, bridge crash-loop | Postgres init script checked out CRLF | `.gitattributes` pins `*.sh` to LF; if already broken, `make nuke` then `make up`, or create DBs manually (see Docker-gotchas notes). |
| `http://localhost:8008` health check fails but server is up | Windows resolves `localhost` → IPv6 `::1`; Synapse binds IPv4 | Use `127.0.0.1:18008` explicitly. |
| Vite watcher crash / `EBUSY` on `src-tauri` | Watching the Rust target dir | Already handled — `vite.config.ts` ignores `**/src-tauri/**`. |

---

## 4. Where to look when something's off

- **App runtime log** (dev session): `%TEMP%\tauri-dev.log`
- **Docker startup crashes**: `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log` (grep for `"error":`)
- **Bridge / WhatsApp**: `infra/data/mautrix-whatsapp/logs/bridge.log`
- **Synapse**: `make logs` or `docker compose logs synapse`
- **Which containers are alive**: `make ps`

---

## 5. Test accounts

Local-stack accounts (registered via `make register-user`; passwords are
whatever you chose — never commit real ones):

- `admin` — the daily account; link it to WhatsApp via the in-app QR flow.
- `verifier` / `sender` — plain Matrix accounts for scripted send/receive tests.
