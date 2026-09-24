# POC Trust — developer entry points. `make help` lists everything.

SHELL := /bin/bash
UI := frontend/poc-trust-ui

.PHONY: help run single test ui-test build compose-up compose-down clean fmt

help:
	@echo "POC Trust — make targets"
	@echo "  make run          dev servers (API :5183 + Vite :5173)"
	@echo "  make single       build UI once, serve UI+API from one origin :5183"
	@echo "  make test         backend build + full xUnit suite"
	@echo "  make ui-test      frontend build + lint + contract/copy checks"
	@echo "  make compose-up   one-command appliance (docker compose up --build)"
	@echo "  make compose-down stop and remove the appliance"

run:
	./run.sh

single:
	./run.sh --single

test:
	dotnet build POCTrust.slnx
	dotnet test POCTrust.slnx

ui-test:
	npm --prefix $(UI) install
	npm --prefix $(UI) run build
	npm --prefix $(UI) run lint
	npm --prefix $(UI) run check:contract

compose-up:
	docker compose up --build

compose-down:
	docker compose down

clean:
	rm -rf $(UI)/dist $(UI)/node_modules src/POCTrust.Api/wwwroot src/POCTrust.Api/poctrust.db
	find . -type d \( -name bin -o -name obj \) -not -path "./.git/*" -exec rm -rf {} +
