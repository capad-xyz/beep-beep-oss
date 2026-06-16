# ─────────────────────────────────────────────────────────────────────────────
# beep-beep-oss — Phase 0 convenience wrapper
#
# These are thin aliases over the exact commands in ../SETUP.md. They save typing
# and prevent typos; they do NOT hide anything — read SETUP.md to understand each
# step. Run `make` (or `make help`) to list targets.
#
# IMPORTANT: there are two MANUAL edit steps that no Makefile should do for you,
# because they encode YOUR choices (passwords, your Matrix ID, your domain):
#   1. After `make generate-synapse` → edit data/synapse/homeserver.yaml
#      (database block + app_service_config_files).  See SETUP.md §1.
#   2. After `make generate-bridge` (first run) → edit
#      data/mautrix-whatsapp/config.yaml  (homeserver, appservice, db,
#      permissions).  See SETUP.md §2.
# ─────────────────────────────────────────────────────────────────────────────

# Use bash and load .env (if present) so DB creds etc. are available to targets.
SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help env generate-synapse generate-bridge link-registration \
        up up-public down restart-synapse logs ps register-user nuke

help: ## Show this help
	@echo "beep-beep-oss — Phase 0"
	@echo
	@echo "Typical first run (see SETUP.md for the full story):"
	@echo "  make env                 # create .env, then edit it"
	@echo "  make generate-synapse    # then hand-edit data/synapse/homeserver.yaml"
	@echo "  make generate-bridge     # then hand-edit data/mautrix-whatsapp/config.yaml"
	@echo "  make generate-bridge     # run again to emit registration.yaml (Ctrl-C after)"
	@echo "  make link-registration   # copy registration where Synapse can read it"
	@echo "  make up                  # start the stack (local)"
	@echo "  make register-user       # create your Matrix account"
	@echo
	@echo "All targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

env: ## Create .env from the example (if it doesn't exist yet)
	@if [ -f .env ]; then echo ".env already exists — leaving it alone."; \
	else cp .env.example .env && echo "Created .env — now edit it (SERVER_NAME, POSTGRES_PASSWORD)."; fi

generate-synapse: ## Generate Synapse's initial config (then hand-edit it — SETUP.md §1)
	docker compose run --rm synapse generate
	@echo ">> Now edit data/synapse/homeserver.yaml (database + app_service_config_files)."

generate-bridge: ## Generate bridge config (1st run) / registration (2nd run) — SETUP.md §2
	docker compose run --rm mautrix-whatsapp

link-registration: ## Copy the bridge registration where Synapse can load it
	cp ./data/mautrix-whatsapp/registration.yaml ./data/synapse/whatsapp-registration.yaml
	@echo ">> Copied. Restart Synapse if it's already running: make restart-synapse"

up: ## Start the stack (LOCAL path)
	docker compose up -d

up-public: ## Start the stack WITH the Caddy TLS proxy (Oracle/public path)
	@if [ ! -f caddy/Caddyfile ]; then cp caddy/Caddyfile.example caddy/Caddyfile; \
		echo "Created caddy/Caddyfile from example."; fi
	docker compose --profile public up -d

down: ## Stop the stack (keeps data)
	docker compose down

restart-synapse: ## Restart only Synapse (e.g. after wiring the registration)
	docker compose restart synapse

logs: ## Follow logs for all services (Ctrl-C to stop)
	docker compose logs -f

ps: ## Show running services
	docker compose ps

register-user: ## Create a Matrix user (interactive)
	docker compose exec synapse \
		register_new_matrix_user -c /data/homeserver.yaml http://localhost:8008

nuke: ## DESTROY all containers AND data (fresh start). Asks for confirmation.
	@read -p "This deletes ALL Phase 0 data (DB, sessions, configs). Type 'yes': " ok; \
	if [ "$$ok" = "yes" ]; then docker compose down -v; rm -rf ./data; \
		echo "Wiped. Start over from 'make generate-synapse'."; \
	else echo "Aborted."; fi
