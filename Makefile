.DEFAULT_GOAL := help
SHELL := /bin/sh
# docker-compose.yml mounts workspaces at this same absolute path (keeps git worktrees valid).
export PWD := $(CURDIR)

.PHONY: help setup token plugins install dev test typecheck build up down logs ps serve stop status clean

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[33m%-10s\033[0m %s\n", $$1, $$2}'

setup: .env install plugins ## First-time setup: .env, deps, plugins
	@mkdir -p workspaces data
	@echo "☸ Ready. Put projects in ./workspaces, then: make dev (local) or make up (docker)."

.env:
	@cp .env.example .env && echo "Created .env — run 'make token' and paste CLAUDE_CODE_OAUTH_TOKEN into it (required for Docker)."

token: ## Generate a long-lived subscription token (paste it into .env)
	claude setup-token

plugins: ## Fetch pinned plugins (superpowers, ui-ux-pro-max, frontend-design)
	@./scripts/fetch-plugins.sh vendor/plugins

install: ## Install npm dependencies
	npm install

dev: plugins ## Run locally with hot reload: web on :5173, api on :8787
	npm run dev

test: ## Run tests
	npm test

typecheck: ## Typecheck server and web
	npm run typecheck

build: ## Build the Docker image
	docker compose build

up: ## Start in Docker on http://127.0.0.1:$SANGHA_PORT
	@grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' .env || { echo "CLAUDE_CODE_OAUTH_TOKEN missing in .env — run: make token"; exit 1; }
	docker compose up -d --build
	@echo "☸ Sangha: http://127.0.0.1:$${SANGHA_PORT:-8787}"

down: ## Stop Docker
	docker compose down

logs: ## Follow Docker logs
	docker compose logs -f

ps: ## Show container status
	docker compose ps

serve: ## Build and run Sangha on this machine, in the background: http://127.0.0.1:8787
	npm run build
	@./scripts/serve.sh start

stop: ## Stop the background Sangha started by make serve
	@./scripts/serve.sh stop

status: ## Is the background Sangha running?
	@./scripts/serve.sh status

clean: ## Remove build outputs (keeps data and workspaces)
	rm -rf apps/*/dist node_modules/.vite
