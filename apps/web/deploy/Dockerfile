# CryoShield web: serves the locally built and verified dist/ (see deploy/README.md, add-fly-hosting D1).
# Build context: apps/web, restricted by .dockerignore to deploy/.build only (no .env, no sources).
# Caddy 2.11.7 (alpine), pinned by multi-arch index digest. Trivy scans this base image on every PR (add-trivy-scan).
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

COPY --chown=0:0 --chmod=0444 deploy/.build/Caddyfile /etc/caddy/Caddyfile
COPY --chown=0:0 deploy/.build/site /srv
RUN chmod -R a-w,a+rX /srv

# Non-root, nothing writable needed: admin API off, auto-HTTPS off (Fly terminates TLS), no persisted config.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 65534:65534
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
