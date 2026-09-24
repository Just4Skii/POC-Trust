# ── Stage 1: build the React UI ────────────────────────────────────────────────
FROM node:24-alpine AS ui
WORKDIR /ui
COPY frontend/poc-trust-ui/package.json frontend/poc-trust-ui/package-lock.json ./
RUN npm ci
COPY frontend/poc-trust-ui/ ./
RUN npm run build

# ── Stage 2: build the .NET API ────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY POCTrust.slnx ./
COPY src/ ./src/
COPY tests/ ./tests/
RUN dotnet restore POCTrust.slnx
COPY . .
RUN dotnet publish src/POCTrust.Api -c Release -o /app --no-restore

# ── Stage 3: single-container runtime (API serves the built UI) ────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=ui /ui/dist ./wwwroot

# The appliance listens on 8080 and serves UI + API from one origin.
ENV ASPNETCORE_URLS=http://+:8080
# SQLite lives on a mounted volume so demonstration data survives restarts.
ENV ConnectionStrings__Default=Data Source=/data/poctrust.db
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 \
  CMD curl -fsS http://localhost:8080/health || wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["dotnet", "POCTrust.Api.dll"]
