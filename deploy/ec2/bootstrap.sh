#!/usr/bin/env bash
# One-time EC2 instance setup for trial-booking.
# Run as root on a fresh Amazon Linux 2023 or Ubuntu 22.04+ instance:
#   curl -fsSL <raw-url>/deploy/ec2/bootstrap.sh | sudo bash
# Or after cloning the repo:
#   sudo bash deploy/ec2/bootstrap.sh
set -euo pipefail

APP_NAME="trial-booking"
APP_USER="trial-booking"
APP_DIR="/opt/trial-booking"
DATA_DIR="/var/lib/trial-booking"
ENV_FILE="/etc/trial-booking/env"
NODE_MAJOR="20"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    echo "${ID:-unknown}"
  else
    echo "unknown"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local version
    version="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "${version}" -ge "${NODE_MAJOR}" ]]; then
      echo "Node $(node -v) already installed"
      return
    fi
  fi

  local os
  os="$(detect_os)"
  echo "Installing Node.js ${NODE_MAJOR}.x..."

  case "${os}" in
    amzn)
      dnf install -y git nginx
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      dnf install -y nodejs
      ;;
    ubuntu | debian)
      apt-get update -y
      apt-get install -y curl git nginx ca-certificates gnupg
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt-get install -y nodejs
      ;;
    *)
      echo "Unsupported OS: ${os}. Install Node ${NODE_MAJOR}+, git, and nginx manually."
      exit 1
      ;;
  esac
}

create_user_and_dirs() {
  if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi

  mkdir -p "${APP_DIR}" "${DATA_DIR}" /etc/trial-booking /var/log/trial-booking
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${DATA_DIR}" /var/log/trial-booking
  chown root:"${APP_USER}" /etc/trial-booking
  chmod 750 /etc/trial-booking
}

install_env_file() {
  chown root:"${APP_USER}" /etc/trial-booking
  chmod 750 /etc/trial-booking

  if [[ -f "${ENV_FILE}" ]]; then
    chmod 640 "${ENV_FILE}"
    chown root:"${APP_USER}" "${ENV_FILE}"
    echo "Keeping existing ${ENV_FILE}"
    return
  fi

  local jwt_secret
  jwt_secret="$(openssl rand -base64 48)"

  cat >"${ENV_FILE}" <<EOF
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
DATABASE_URL=file:${DATA_DIR}/production.db
JWT_SECRET=${jwt_secret}
EOF

  chmod 640 "${ENV_FILE}"
  chown root:"${APP_USER}" "${ENV_FILE}"
  echo "Created ${ENV_FILE} with a generated JWT_SECRET"
}

install_systemd() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  install -m 644 "${repo_root}/deploy/ec2/systemd/trial-booking.service" /etc/systemd/system/trial-booking.service
  systemctl daemon-reload
  systemctl enable trial-booking
}

install_nginx() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local site_name="trial-booking"

  case "$(detect_os)" in
    amzn)
      install -m 644 "${repo_root}/deploy/ec2/nginx/trial-booking.conf" /etc/nginx/conf.d/trial-booking.conf
      ;;
    ubuntu | debian)
      install -m 644 "${repo_root}/deploy/ec2/nginx/trial-booking.conf" "/etc/nginx/sites-available/${site_name}"
      ln -sf "/etc/nginx/sites-available/${site_name}" "/etc/nginx/sites-enabled/${site_name}"
      rm -f /etc/nginx/sites-enabled/default
      ;;
  esac

  nginx -t
  systemctl enable nginx
  systemctl restart nginx
}

install_node
create_user_and_dirs
install_env_file
install_systemd
install_nginx

echo ""
echo "Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Clone the repo into ${APP_DIR} as ${APP_USER}, or run deploy/ec2/deploy.sh from a checkout."
echo "  2. Review ${ENV_FILE} and adjust secrets if needed."
echo "  3. Open EC2 security group ports 22, 80 (and 443 after TLS)."
echo "  4. Run: sudo -u ${APP_USER} bash ${APP_DIR}/deploy/ec2/deploy.sh --seed"
echo ""
