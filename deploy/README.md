# Выкладка на сервер (Selectel / любой VPS в РФ)

На одной машине в Docker работают PostgreSQL 17, приложение (API и интерфейс) и Caddy. Caddy отвечает
за HTTPS: если указан домен, сертификат Let's Encrypt выпускается автоматически.

## 1. Сервер в Selectel
Облачная платформа → Облачные серверы → создать сервер:
- **регион:** Москва или Санкт-Петербург;
- **ОС:** Ubuntu 24.04 LTS;
- **конфигурация:** 2 vCPU, 4 ГБ RAM, диск 30–40 ГБ (SSD);
- **сеть:** публичный IP-адрес;
- **доступ:** SSH-ключ (рекомендуется) или пароль root.

## 2. Первичная настройка (один раз)
```bash
ssh root@IP_СЕРВЕРА
# демо-данные для бета-теста (пароль у всех 123):
curl -fsSL https://raw.githubusercontent.com/WVNNVCRY/akty-beta/main/deploy/server-setup.sh | DEMO=1 bash
# или чистая база с одним администратором:
curl -fsSL https://raw.githubusercontent.com/WVNNVCRY/akty-beta/main/deploy/server-setup.sh | ADMIN_LOGIN=admin ADMIN_PASSWORD='надёжный-пароль' bash
```
Добавьте `DOMAIN=akty.example.ru` перед `bash`, если есть домен с A-записью на IP сервера.

**Что делает скрипт:**
- ставит Docker и создаёт swap;
- клонирует репозиторий в `/opt/akty`;
- генерирует случайные пароль базы и JWT-секрет в `deploy/.env` (они остаются только на сервере);
- открывает порты 22, 80 и 443;
- собирает и запускает приложение;
- настраивает ежедневный бэкап базы в `/opt/akty-backups` с хранением 14 дней.

## 3. Автовыкладка из GitHub
Каждый push в `main` запускает CI. Если тесты прошли, workflow **Deploy to server** обновляет сервер.

**Один раз:**
1. На своём компьютере создайте ключ только для выкладки: `ssh-keygen -t ed25519 -f akty_deploy -N ""`.
2. Добавьте публичный ключ на сервер: `ssh-copy-id -i akty_deploy.pub root@IP` или допишите его в `~/.ssh/authorized_keys`.
3. В GitHub откройте Settings → Secrets and variables → Actions и создайте секреты:
   - `SSH_HOST`: IP сервера;
   - `SSH_USER`: `root`;
   - `SSH_KEY`: содержимое файла `akty_deploy` (приватный ключ).

Пока секреты не заданы, выкладка просто пропускается. Обновить вручную: `bash /opt/akty/deploy/update.sh`.

## Обслуживание
```bash
cd /opt/akty; C="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
$C ps                                   # статус
$C logs -f app                          # логи приложения
$C exec app npx tsx prisma/init.ts      # (с -e ADMIN_LOGIN=… -e ADMIN_PASSWORD=…) добавить администратора
$C exec -e SEED_RESET=1 app npx tsx prisma/seed.ts   # СТЕРЕТЬ всё и залить демо-данные
# восстановление из бэкапа:
$C exec -T db pg_restore -U akty -d akty --clean --if-exists < /opt/akty-backups/akty-ГГГГ-ММ-ДД.dump
```

## Переход на управляемую базу
Managed PostgreSQL в Selectel или Yandex Cloud: в `deploy/docker-compose.yml` удалите сервис `db`
и задайте в `DATABASE_URL` адрес управляемой базы. Код менять не нужно. Файлы можно перенести
в S3 (Selectel S3 или Yandex Object Storage), заполнив `STORAGE=s3` и `S3_*` в `deploy/.env`.
