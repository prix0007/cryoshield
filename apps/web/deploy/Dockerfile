# CryoShield web: serves the locally built and verified dist/ (see deploy/README.md, add-fly-hosting D1).
# Build context: apps/web, restricted by .dockerignore to deploy/.build only (no .env, no sources).
# Caddy 2.11.7 (alpine), pinned by multi-arch index digest. Trivy scans this base image on every PR (add-trivy-scan).
# 2026-10-21 rebuild of the tag (alpine 3.23.6 with musl 1.2.5-r24; the Go toolchain is still 1.26.8), change
# patch-caddy-image-2026-10.
FROM caddy:2.11.7-alpine@sha256:24ec7b05bc532c7bb57f727030c5056e257ff7138b4b50460306819ff79362bd

COPY --chown=0:0 --chmod=0444 deploy/.build/Caddyfile /etc/caddy/Caddyfile
COPY --chown=0:0 deploy/.build/site /srv
RUN chmod -R a-w,a+rX /srv

# Non-root, nothing writable needed: admin API off, auto-HTTPS off (Fly terminates TLS), no persisted config.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 65534:65534
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
