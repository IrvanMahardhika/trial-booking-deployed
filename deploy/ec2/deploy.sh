#!/usr/bin/env bash
# Build and deploy trial-booking on the EC2 instance.
# First deploy (with seed data):
#   sudo bash deploy/ec2/deploy.sh --seed
# Subsequent deploys:
#   sudo bash deploy/ec2/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trial-booking}"
ENV_FILE="${ENV_FILE:-/etc/trial-booking/env}"
RELEASES_DIR="${APP_DIR}/releases"
CURRENT_LINK="${APP_DIR}/current"
SEED=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--seed]

  --seed   Run database seed after schema push (first deploy only)

Environment overrides:
  APP_DIR     Application root (default: /opt/trial-booking)
  ENV_FILE    Production env file (default: /etc/trial-booking/env)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)
      SEED=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run deploy/ec2/bootstrap.sh first."
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "Clone the repository to ${APP_DIR} before deploying."
  exit 1
fi

APP_USER="${APP_USER:-trial-booking}"

run_as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    "$@"
  elif [[ "$(id -u)" -eq 0 ]]; then
    # sudo drops the caller environment by default; pass deploy vars explicitly.
    # Avoid `env --` — not supported on all systems (e.g. Amazon Linux env).
    sudo -u "${APP_USER}" env \
      "SEED=${SEED}" \
      "ENV_FILE=${ENV_FILE}" \
      "APP_DIR=${APP_DIR}" \
      "RELEASES_DIR=${RELEASES_DIR}" \
      "CURRENT_LINK=${CURRENT_LINK}" \
      "$@"
  else
    echo "Run as root or as ${APP_USER}."
    exit 1
  fi
}

ensure_build_memory() {
  if [[ "$(id -u)" -ne 0 ]]; then
    return
  fi

  if swapon --show | grep -q .; then
    return
  fi

  local mem_mb
  mem_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
  if [[ "${mem_mb}" -ge 2048 ]]; then
    return
  fi

  echo "Low memory (${mem_mb} MB) and no swap detected; creating 2G swap file for the build..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

cd "${APP_DIR}"

if [[ -d .git ]]; then
  # Git refuses pulls when the repo owner differs from the caller (e.g. after bootstrap chown).
  run_as_app_user git -C "${APP_DIR}" pull --ff-only
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
  fi
fi

deploy_build() {
  APP_DIR="${APP_DIR:-/opt/trial-booking}"
  ENV_FILE="${ENV_FILE:-/etc/trial-booking/env}"
  RELEASES_DIR="${RELEASES_DIR:-${APP_DIR}/releases}"
  CURRENT_LINK="${CURRENT_LINK:-${APP_DIR}/current}"

  cd "${APP_DIR}"

  if [[ ! -r "${ENV_FILE}" ]]; then
    echo "Cannot read ${ENV_FILE} as $(id -un). Check file permissions."
    exit 1
  fi

  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a

  echo "Installing dependencies (including devDependencies required to build)..."
  # NODE_ENV=production in the env file would omit devDependencies (tsx, typescript, etc.).
  NODE_ENV=development npm ci --include=dev

  if [[ ! -d node_modules/@tailwindcss/postcss ]]; then
    echo "Missing @tailwindcss/postcss after npm ci."
    exit 1
  fi

  echo "Generating Prisma client..."
  npm run db:generate

  echo "Applying database schema..."
  npx prisma db push --skip-generate

  if [[ "${SEED}" == "true" ]]; then
    echo "Seeding database..."
    npx tsx prisma/seed.ts
  fi

  echo "Building application..."
  rm -rf .next
  export NODE_ENV=production
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
  npm run build

  if [[ ! -f .next/standalone/server.js ]]; then
    echo "Build failed: .next/standalone/server.js was not created."
    exit 1
  fi

  RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
  RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
  mkdir -p "${RELEASE_DIR}"

  echo "Assembling release ${RELEASE_ID}..."
  cp -a .next/standalone/. "${RELEASE_DIR}/"
  mkdir -p "${RELEASE_DIR}/.next"
  cp -a .next/static "${RELEASE_DIR}/.next/static"
  cp -a public "${RELEASE_DIR}/public"

  ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"
  echo "${RELEASE_ID}" > "${APP_DIR}/.current-release"
}

ensure_build_memory

if [[ "$(id -un)" == "${APP_USER}" ]]; then
  deploy_build
else
  run_as_app_user bash -c "set -euo pipefail; $(declare -f deploy_build); deploy_build"
fi

restart_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; start manually from ${CURRENT_LINK}:"
    echo "  node server.js"
    return
  fi

  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart trial-booking
    systemctl --no-pager status trial-booking
  elif sudo -n systemctl restart trial-booking 2>/dev/null; then
    sudo systemctl --no-pager status trial-booking
  else
    echo "Could not restart trial-booking.service (run as root or with sudo)."
    exit 1
  fi
}

restart_service

if [[ -f "${APP_DIR}/.current-release" ]]; then
  echo "Deploy complete. Active release: $(cat "${APP_DIR}/.current-release")"
else
  echo "Deploy complete."
fi
