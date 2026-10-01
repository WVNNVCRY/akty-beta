#!/bin/bash
# Первичная настройка сервера (Ubuntu 22.04/24.04, запуск от root):
#   curl -fsSL https://raw.githubusercontent.com/WVNNVCRY/akty-beta/main/deploy/server-setup.sh | bash
# Переменные (необязательно): DOMAIN=akty.example.ru  DEMO=1 (залить демо-данные)  ADMIN_LOGIN / ADMIN_PASSWORD
set -euo pipefail
REPO=https://github.com/WVNNVCRY/akty-beta.git
DIR=/opt/akty

echo "== Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
command -v git >/dev/null || (apt-get update -q && apt-get install -y -q git)

echo "== Swap 2 ГБ (сборка фронтенда требовательна к памяти)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Код"
if [ -d $DIR/.git ]; then git -C $DIR fetch -q && git -C $DIR reset -q --hard origin/main; else git clone -q $REPO $DIR; fi
cd $DIR

echo "== Настройки deploy/.env"
if [ ! -f deploy/.env ]; then
  cp deploy/.env.example deploy/.env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|; s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" deploy/.env
  chmod 600 deploy/.env
fi
[ -n "${DOMAIN:-}" ] && sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" deploy/.env

echo "== Файрвол"
if command -v ufw >/dev/null; then ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; fi

echo "== Сборка и запуск (первый раз 3–6 минут)"
C="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
$C up -d --build
for i in $(seq 1 60); do $C exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 3; done

if [ "${DEMO:-0}" = "1" ]; then
  echo "== Демо-данные (пароль у всех 123)"
  $C exec -T -e SEED_RESET=1 app npx tsx prisma/seed.ts >/dev/null
elif [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "== Администратор"
  $C exec -T -e ADMIN_LOGIN="${ADMIN_LOGIN:-admin}" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" app npx tsx prisma/init.ts
fi

echo "== Ежедневный бэкап базы (03:30, хранится 14 дней, /opt/akty-backups)"
mkdir -p /opt/akty-backups
cat > /etc/cron.d/akty-backup <<CRON
30 3 * * * root cd $DIR && $C exec -T db pg_dump -U akty -Fc akty > /opt/akty-backups/akty-\$(date +\%F).dump && find /opt/akty-backups -name '*.dump' -mtime +14 -delete
CRON

IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
D=$(grep ^DOMAIN= deploy/.env | cut -d= -f2)
echo
echo "Готово: ${D:+https://$D}${D:-http://$IP}"
