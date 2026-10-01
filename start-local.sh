#!/usr/bin/env bash
# Локальный стенд «Акты скрытых работ» в Docker.
#   ./start-local.sh          — собрать и запустить; при первом запуске заполнить БД пользователями и справочниками
#   ./start-local.sh --demo   — пересоздать БД с тестовыми объектами (все статусы процесса)
#   ./start-local.sh --reset  — пересоздать БД без объектов (пользователи и справочники)
#   ./start-local.sh --stop   — остановить
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose -f local/docker-compose.yml"
command -v docker >/dev/null || { echo "Нужен Docker Desktop (Windows/macOS) или Docker Engine (Linux): https://docs.docker.com/get-docker/"; exit 1; }

case "${1:-}" in
  --stop) $DC down; echo "Стенд остановлен. Данные сохранены в томе Docker."; exit 0 ;;
esac

echo "→ Сборка и запуск (первый раз 3–5 минут)…"
$DC up -d --build

echo -n "→ Ожидание готовности сервера"
for i in $(seq 1 90); do
  if curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then echo " — готово"; break; fi
  echo -n "."; sleep 2
  [ "$i" = 90 ] && { echo; echo "Сервер не ответил. Журнал: $DC logs app"; exit 1; }
done

seed() { $DC exec -T -e SEED_RESET=1 -e SEED_DEMO_OBJECTS="$1" app npx tsx prisma/seed.ts >/dev/null && echo "→ База заполнена${2}"; }
USERS=$($DC exec -T db psql -U akty -d akty -tAc 'SELECT count(*) FROM users' 2>/dev/null | tr -d '[:space:]' || echo 0)
case "${1:-}" in
  --demo)  seed 1 " (с тестовыми объектами)" ;;
  --reset) seed 0 " (без объектов)" ;;
  *) [ "${USERS:-0}" = "0" ] && seed 0 " (пользователи и справочники, объектов нет)" ;;
esac

cat <<'TXT'

  Готово:  http://localhost:8080
  Вход: gc / manager / mech / hand / thermo / client / client2, пароль 123
  Остановить: ./start-local.sh --stop     Журнал: docker compose -f local/docker-compose.yml logs -f app
TXT
