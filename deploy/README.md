# Deploy to AWS EC2

This guide deploys the trial-booking Next.js app on a single EC2 instance with:

- **Node.js 20** — standalone Next.js build
- **systemd** — process manager with auto-restart
- **nginx** — reverse proxy on port 80
- **SQLite** — persistent database at `/var/lib/trial-booking/production.db`

Supported OS images: **Amazon Linux 2023** or **Ubuntu 22.04+**.

## 1. Launch an EC2 instance

| Setting | Recommendation |
|---|---|
| AMI | Amazon Linux 2023 or Ubuntu 22.04 LTS |
| Instance type | `t3.small` (or `t3.micro` for demos) |
| Storage | 20 GB gp3 (SQLite + releases) |
| Key pair | Create or select an SSH key |

### Security group inbound rules

| Port | Source | Purpose |
|---|---|---|
| 22 | Your IP | SSH |
| 80 | `0.0.0.0/0` | HTTP (nginx) |
| 443 | `0.0.0.0/0` | HTTPS (optional, after TLS) |

Do **not** expose port 3000 publicly — nginx proxies to the app on localhost.

## 2. Bootstrap the server (one time)

SSH into the instance, then clone and bootstrap:

```bash
sudo dnf install -y git    # Amazon Linux
# sudo apt-get install -y git   # Ubuntu

sudo git clone https://github.com/IrvanMahardhika/trial-booking-deployed.git /opt/trial-booking
cd /opt/trial-booking
sudo bash deploy/ec2/bootstrap.sh
```

Bootstrap installs Node.js, nginx, creates the `trial-booking` system user, writes `/etc/trial-booking/env` (with a generated `JWT_SECRET`), and registers the systemd + nginx configs.

Review the environment file before going live:

```bash
sudo cat /etc/trial-booking/env
```

See `deploy/ec2/env.example` for all variables.

## 3. Deploy the application

First deploy (creates schema and seeds demo data):

```bash
cd /opt/trial-booking
sudo git pull
sudo bash deploy/ec2/deploy.sh --seed
```

Subsequent deploys:

```bash
cd /opt/trial-booking
sudo git pull
sudo bash deploy/ec2/deploy.sh
```

The deploy script:

1. Installs dependencies (`npm ci`)
2. Applies the Prisma schema to SQLite
3. Builds the standalone Next.js bundle
4. Publishes a timestamped release under `/opt/trial-booking/releases/`
5. Symlinks `/opt/trial-booking/current` to the new release
6. Restarts `trial-booking.service`

## 4. Verify

Open `http://<ec2-public-ip>/login` in a browser.

Demo accounts (after `--seed`):

| Email | Password |
|---|---|
| `alice@example.com` | `demo123` |
| `bob@example.com` | `demo123` |
| `carla@example.com` | `demo123` |

### Useful commands

```bash
# App logs
sudo tail -f /var/log/trial-booking/app.log

# Service status
sudo systemctl status trial-booking

# nginx logs
sudo tail -f /var/log/nginx/trial-booking.error.log

# Restart app only
sudo systemctl restart trial-booking
```

## 5. Enable HTTPS (recommended)

On Ubuntu:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

On Amazon Linux 2023, install certbot from your preferred method (snap, pip, or acme.sh) and point nginx at the certificate paths.

After TLS is enabled, restrict port 80/443 sources as needed and keep `JWT_SECRET` private.

## Architecture

```
Internet → EC2:80 (nginx) → localhost:3000 (Next.js standalone)
                                    ↓
                         /var/lib/trial-booking/production.db
```

Each deploy creates an immutable release directory. Only the `current` symlink changes, so rollbacks are a single `ln -sfn` plus `systemctl restart`.

### Rollback

```bash
ls -1 /opt/trial-booking/releases/
sudo ln -sfn /opt/trial-booking/releases/<previous-release-id> /opt/trial-booking/current
sudo systemctl restart trial-booking
```

## Files

| Path | Purpose |
|---|---|
| `deploy/ec2/bootstrap.sh` | One-time server setup |
| `deploy/ec2/deploy.sh` | Build and release script |
| `deploy/ec2/systemd/trial-booking.service` | systemd unit |
| `deploy/ec2/nginx/trial-booking.conf` | nginx reverse proxy |
| `deploy/ec2/env.example` | Production environment template |
| `/etc/trial-booking/env` | Live secrets (created by bootstrap) |
| `/var/lib/trial-booking/` | SQLite database (persistent) |

## Troubleshooting

### `Environment variable not found: DATABASE_URL`

`sudo` drops environment variables by default. Use the latest `deploy/ec2/deploy.sh`, which passes deploy settings explicitly to the `trial-booking` user.

Verify the env file exists and is readable (`/etc/trial-booking` must be `root:trial-booking` mode `750`):

```bash
sudo ls -ld /etc/trial-booking /etc/trial-booking/env
sudo -u trial-booking cat /etc/trial-booking/env
```

If permission is denied, fix directory and file ownership:

```bash
sudo chown root:trial-booking /etc/trial-booking
sudo chmod 750 /etc/trial-booking
sudo chown root:trial-booking /etc/trial-booking/env
sudo chmod 640 /etc/trial-booking/env
```

### `npm run build` killed / out of memory

`t3.micro` (1 GB RAM) is often too small for a Next.js production build. The deploy script auto-creates a 2 GB swap file on low-memory instances. You can also add swap manually:

```bash
sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

Or use a `t3.small` (2 GB RAM) instance.

### `dubious ownership` during `git pull`

Run:

```bash
sudo chown -R trial-booking:trial-booking /opt/trial-booking
sudo bash deploy/ec2/deploy.sh --seed
```

## Production notes

- **SQLite** is fine for a single-instance demo. For multi-instance or higher durability, migrate to RDS Postgres and update `DATABASE_URL`.
- **Sessions and rate limits** are in-memory per process — not suitable for horizontal scaling without Redis.
- **Admin roster** (`/admin/roster`) has no auth — restrict by network or add auth before production use.
- Back up `/var/lib/trial-booking/production.db` regularly (EBS snapshots or `scp`).
