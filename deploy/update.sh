#!/bin/bash
# Обновление на сервере до последней версии main (его же вызывает GitHub Actions)
set -euo pipefail
cd /opt/akty
git fetch -q && git reset -q --hard origin/main
C="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
$C up -d --build
docker image prune -f >/dev/null
for i in $(seq 1 60); do $C exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && { echo "OK: $(git log --oneline -1)"; exit 0; }; sleep 3; done
echo "Приложение не отвечает"; $C logs --tail 50 app; exit 1
