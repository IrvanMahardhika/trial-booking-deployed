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
    sudo -u "${APP_USER}" -- "$@"
  else
    echo "Run as root or as ${APP_USER}."
    exit 1
  fi
}

cd "${APP_DIR}"

if [[ -d .git ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    git -C "${APP_DIR}" pull --ff-only
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
  else
    run_as_app_user git -C "${APP_DIR}" pull --ff-only
  fi
fi

deploy_build() {
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a

  echo "Installing dependencies..."
  npm ci

  echo "Generating Prisma client..."
  npm run db:generate

  echo "Applying database schema..."
  npx prisma db push --skip-generate

  if [[ "${SEED}" == "true" ]]; then
    echo "Seeding database..."
    npm run db:seed
  fi

  echo "Building application..."
  npm run build

  RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
  RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
  mkdir -p "${RELEASE_DIR}"

  echo "Assembling release ${RELEASE_ID}..."
  cp -a .next/standalone/. "${RELEASE_DIR}/"
  mkdir -p "${RELEASE_DIR}/.next"
  cp -a .next/static "${RELEASE_DIR}/.next/static"
  cp -a public "${RELEASE_DIR}/public"

  ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"
}

export SEED ENV_FILE RELEASES_DIR CURRENT_LINK APP_DIR

if [[ "$(id -un)" == "${APP_USER}" ]]; then
  deploy_build
else
  run_as_app_user bash -c "$(declare -f deploy_build); deploy_build"
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

echo "Deploy complete. Active release: ${RELEASE_ID}"
