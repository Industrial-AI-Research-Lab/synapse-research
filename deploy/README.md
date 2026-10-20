# Production deployment — Synapse Research

Production использует три контейнера: frontend, backend и Caddy. Снаружи доступны порты 80 и 443; Caddy направляет `/api/*` в backend, остальные запросы — во frontend.

## Один ENV-файл

Все настройки хранятся на VPS в `/opt/pav/.env`. Production Compose использует его и для подстановки адресов образов, и как `env_file` backend. Отдельный `backend.env` больше не нужен.

Полный шаблон — [`.env.example`](.env.example) в этом каталоге. Он содержит настройки развёртывания и приложения, включая оба workflow Synapse.

Для существующего сервера откройте `/opt/pav/.env` и дополните нужные параметры. Сохраните действующие код доступа, адрес сайта и настройки Synapse. Для образов из этого репозитория задайте:

```dotenv
GHCR_OWNER=industrial-ai-research-lab
```

`IMAGE_TAG` — полный SHA опубликованного коммита. Workflow передаёт его при развёртывании; при ручном запуске значение нужно указать в `.env` или передать в окружении команды. Образы с тегом `latest` этот workflow не публикует.

`DOCUMENT_ACCESS_TOKEN` обязателен для production Compose. Клиент передаёт его как `Authorization: Bearer <код>` при работе с документами и исследованиями. Для генерации нового кода можно использовать `openssl rand -hex 32`. Параметр `DOCUMENT_ACCESS_CODE_COPY_ENABLED` оставьте `false`; кнопка копирования кода предназначена только для временного стенда.

Пароли с символами `$` и `#` заключайте в одинарные кавычки, чтобы Compose прочитал их буквально.

## Новый VPS

1. Скопируйте `bootstrap-vps.sh` на Ubuntu 24.04 и выполните от `root`. Скрипт устанавливает Docker, открывает стандартные порты SSH, HTTP и HTTPS, создаёт `/opt/pav` и начальный `.env`.
2. Заполните `/opt/pav/.env` по полному шаблону из этого каталога. Установите права `chmod 600 /opt/pav/.env`.
3. Добавьте публичную часть отдельного SSH-ключа развёртывания в `/root/.ssh/authorized_keys`.
4. Настройте GitHub Secrets и окружение `production` в новом репозитории.

Для первого открытия по IP используется `CADDY_SITE_ADDRESS=:80`. Когда DNS A-запись домена указывает на VPS, замените значение на имя домена и пересоздайте Caddy. При доступных портах 80 и 443 Caddy получает и продлевает HTTPS-сертификаты.

## GitHub Secrets

| Secret | Значение |
| --- | --- |
| `VPS_HOST` | Публичный IPv4 сервера |
| `VPS_USER` | Пользователь SSH; для текущей схемы — `root` |
| `VPS_DEPLOY_KEY` | Приватная часть SSH-ключа развёртывания |
| `GHCR_PULL_TOKEN` | GitHub token с правом `read:packages` и доступом к образам организации |
| `GHCR_USERNAME` | Необязательный логин владельца pull-токена; по умолчанию используется пользователь, запустивший workflow |

Учётная запись для `docker login` — владелец токена, а не название организации. Если это другой пользователь, задайте `GHCR_USERNAME`.

GitHub Secrets и настройки окружения не переносятся обычным `git push`. В организации также должен быть разрешён выпуск пакетов этим репозиторием.

## Сборка и развёртывание

Workflow `.github/workflows/deploy.yml` проверяет backend и frontend для pull request в `master`. При push в `master` после проверок он:

1. Публикует пару образов `ghcr.io/industrial-ai-research-lab/synapse-research-backend:<SHA>` и `synapse-research-frontend:<SHA>`.
2. Копирует `compose.yml` и `Caddyfile` в `/opt/pav`.
3. Авторизует VPS в GHCR, скачивает оба образа указанной версии и запускает стек.
4. Выходит из GHCR и проверяет `/api/health`.

ENV-файл на VPS при этом не перезаписывается. При добавлении новой настройки её нужно внести в `/opt/pav/.env` отдельно. `synapse_configured: true` в health-ответе означает наличие обязательных настроек, а не проверку пароля или выполнение workflow в Synapse.

При первом развёртывании из нового репозитория убедитесь, что `GHCR_OWNER` в серверном `.env` соответствует новой организации. Если старый репозиторий тоже развёртывается на этот VPS, оставьте автоматическое развёртывание активным только в одном репозитории.

## Применение ENV на работающем сервере

Обычный `docker compose restart` сохраняет прежнее окружение контейнеров. После редактирования `/opt/pav/.env` выполните:

```bash
cd /opt/pav
pav_backend_id=$(docker ps -aq --filter label=com.docker.compose.project=pav-evidence-navigator --filter label=com.docker.compose.service=backend)
pav_backend_image=$(docker inspect --format '{{.Config.Image}}' "$pav_backend_id")
IMAGE_TAG="${pav_backend_image##*:}" docker compose --env-file .env up -d --force-recreate
```

Команды рассчитаны на уже созданный backend и на то, что в `.env` указан владелец его образов. При переходе на новую пару образов используйте SHA, опубликованный новым репозиторием, и предварительно выполните авторизацию в GHCR и `docker compose pull` с тем же `IMAGE_TAG`.

Проверка после запуска:

```bash
docker compose ps
curl --fail http://localhost/api/health
```

## Данные и совместимость

Имя production Compose-проекта `pav-evidence-navigator` и каталог `/opt/pav` сохранены для существующего VPS. Docker связывает имена постоянных томов с именем проекта: его переименование создаст другое хранилище.

Том `document_store` смонтирован в `/service/var/documents`. Он содержит исходные документы, индекс, `researches.sqlite3` и кеш материалов. `caddy_data` хранит HTTPS-сертификаты. Обновление контейнеров сохраняет эти тома; `docker compose down -v` удаляет их.

Резервная копия документного хранилища должна включать файлы и базу истории из одного согласованного снимка.
