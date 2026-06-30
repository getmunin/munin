#!/bin/sh
set -eu

# In production the backend rejects placeholder secrets (see
# assertProductionAuthSecret). To keep `docker compose up` a true one-command
# start, generate any unset/placeholder secret here and persist it under a
# volume so it stays stable across restarts — a rotating MUNIN_ENCRYPTION_KEY
# would make previously-stored secrets unrecoverable.
SECRET_DIR="${MUNIN_SECRET_DIR:-/var/munin/secrets}"
mkdir -p "$SECRET_DIR"

is_placeholder() {
  case "$1" in
    "" | replace-me* | replace_me* | dev-secret* | dev_secret* | test-secret* | changeme* | do-not-use* | do_not_use*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_secret() {
  name="$1"
  file="$SECRET_DIR/$name"
  eval "val=\${$name:-}"
  if is_placeholder "$val"; then
    if [ ! -s "$file" ]; then
      head -c 48 /dev/urandom | base64 | tr -d '\n' >"$file"
      echo "munin: generated $name (persisted in $SECRET_DIR — set it explicitly for shared/production deployments)"
    fi
    export "$name=$(cat "$file")"
  fi
}

ensure_secret MUNIN_AUTH_SECRET
ensure_secret MUNIN_KEY_PEPPER
ensure_secret MUNIN_ENCRYPTION_KEY
ensure_secret MUNIN_STORAGE_LOCAL_SECRET

exec "$@"
