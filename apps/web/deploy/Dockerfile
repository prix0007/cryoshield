# CryoShield web: serves the locally built and verified dist/ (see deploy/README.md, add-fly-hosting D1).
# Build context: apps/web, restricted by .dockerignore to deploy/.build only (no .env, no sources).
# Caddy 2.11.4 (alpine), pinned by multi-arch index digest.
FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b

COPY --chown=0:0 --chmod=0444 deploy/.build/Caddyfile /etc/caddy/Caddyfile
COPY --chown=0:0 deploy/.build/site /srv
RUN chmod -R a-w,a+rX /srv

# Non-root, nothing writable needed: admin API off, auto-HTTPS off (Fly terminates TLS), no persisted config.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 65534:65534
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
