#!/bin/sh
# Railway mounts Volumes as root. Fix ownership, then drop to the unprivileged "node" user.
set -e
DB_FILE="${DB_PATH:-${RAILWAY_VOLUME_MOUNT_PATH:+$RAILWAY_VOLUME_MOUNT_PATH/chat.db}}"
DB_FILE="${DB_FILE:-/app/data/chat.db}"
DB_DIR="$(dirname "$DB_FILE")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DB_DIR"
  chown -R node:node "$DB_DIR"
  exec su-exec node "$@"
fi
exec "$@"
