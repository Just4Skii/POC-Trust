#!/usr/bin/env bash
# POC Trust — development launcher (no Docker required).
#
#   ./run.sh            dev mode:  API on :5183 + Vite UI on :5173 (proxy wired)
#   ./run.sh --single   packaged:  build the UI once, API serves it on :5183 (one origin)
#
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

ensure_dotnet() {
  if ! command -v dotnet >/dev/null 2>&1; then
    echo "dotnet SDK not found — installing .NET 10 into ~/.dotnet ..."
    curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0
    export DOTNET_ROOT="$HOME/.dotnet"
    export PATH="$PATH:$DOTNET_ROOT"
  fi
}

if [[ "${1:-}" == "--single" ]]; then
  bold "▶ Building UI (single-origin mode)..."
  (cd frontend/poc-trust-ui && npm install && npm run build)
  bold "▶ Staging UI into src/POCTrust.Api/wwwroot ..."
  rm -rf src/POCTrust.Api/wwwroot
  cp -r frontend/poc-trust-ui/dist src/POCTrust.Api/wwwroot
  bold "▶ Starting POC Trust on http://localhost:5183 (UI + API from one origin)"
  dotnet run --project src/POCTrust.Api
else
  ensure_dotnet
  bold "▶ Starting API on http://localhost:5183 ..."
  dotnet run --project src/POCTrust.Api &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null || true' EXIT

  bold "▶ Starting UI on http://localhost:5173 (proxies /api → :5183) ..."
  (cd frontend/poc-trust-ui && npm install >/dev/null && npm run dev)
fi
