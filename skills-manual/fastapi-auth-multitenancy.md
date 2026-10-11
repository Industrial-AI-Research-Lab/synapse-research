# FastAPI: Аутентификация и Мультитенантность

## Обзор

Synapse использует JWT-based аутентификацию с ролевой моделью (RBAC) и тенантной изоляцией данных. Все защищённые эндпоинты получают контекст пользователя через систему зависимостей FastAPI (`Depends`).

---

## Архитектура

```
Request → Authorization: Bearer <JWT>
         ↓
    require_auth()          ← декодирует JWT, загружает user из MongoDB
         ↓
    require_role("role")    ← проверяет иерархию ролей
         ↓
    get_tenant_context()    ← создаёт TenantContext(tenant_id, user_id, role)
         ↓
    endpoint handler        ← использует ctx.tenant_id для фильтрации данных
```

## Ключевые компоненты

### 1. JWT-токены (`src/api/auth/utils.py`)

```python
# Access token (короткоживущий, ~60 мин)
create_access_token(user_id, tenant_id, role) → JWT
# Payload: { sub: user_id, tenant_id, role, exp, iat, type: "access" }

# Refresh token (долгоживущий, ~30 дней)
create_refresh_token(user_id) → JWT
# Payload: { sub: user_id, exp, iat, type: "refresh" }

# Декодирование
decode_token(token) → payload dict
# Бросает jwt.ExpiredSignatureError или jwt.InvalidTokenError
```

**Env-переменные:**
| Переменная | Default | Описание |
|-----------|---------|----------|
| `JWT_SECRET_KEY` | `dev-secret-change-me-in-production` | Секрет для подписи JWT |
| `JWT_ACCESS_EXPIRE_MINUTES` | `60` | TTL access token |
| `JWT_REFRESH_EXPIRE_DAYS` | `30` | TTL refresh token |

### 2. Middleware (`src/api/auth/middleware.py`)

```python
# Базовая аутентификация — декодирует JWT, загружает user
async def require_auth(request: Request) -> dict:
    # 1. Берёт Authorization: Bearer <token>
    # 2. decode_token(token) → payload
    # 3. storage.get_user_by_id(payload["sub"]) → user
    # 4. Проверяет user["enabled"]
    # 5. Возвращает user dict

# Ролевая проверка — обёртка над require_auth
def require_role(minimum_role: str):
    # Возвращает Depends-функцию которая:
    # 1. Вызывает require_auth()
    # 2. Проверяет _role_level(user["role"]) >= _role_level(minimum_role)
    # 3. Возвращает user dict или 403
```

**Иерархия ролей:**
```
root (4) > tenant_admin (3) > developer (2) > viewer (1)
```

### 3. TenantContext (`src/api/auth/tenant_context.py`)

```python
@dataclass
class TenantContext:
    tenant_id: str
    user_id: str
    role: str

async def get_tenant_context(user: dict = Depends(require_auth)) -> TenantContext:
    return TenantContext(
        tenant_id=user.get("tenant_id", ""),
        user_id=user["_id"],
        role=user["role"],
    )
```

---

## Паттерны использования

### Паттерн 1: Публичный эндпоинт (без авторизации)

```python
@router.post("/login")
async def login(body: LoginRequest):
    # Никаких Depends — доступен всем
    ...
```

### Паттерн 2: Аутентифицированный эндпоинт

```python
@router.get("/me")
async def get_me(user: dict = Depends(require_auth)):
    # user — dict из MongoDB (с _id, email, role, tenant_id)
    return MeResponse(user_id=user["_id"], ...)
```

### Паттерн 3: Ролевое ограничение

```python
@router.get("/users")
async def list_users(user: dict = Depends(require_role("tenant_admin"))):
    # Только tenant_admin и root могут вызвать
    # user["role"] гарантированно >= tenant_admin
    ...
```

### Паттерн 4: Тенантная изоляция (основной)

```python
@router.get("/", response_model=list[ToolConfigurationResponse])
async def list_tools(ctx: TenantContext = Depends(get_tenant_context)):
    storage = deps.get_storage()
    # Фильтрация: только tools этого тенанта + __system__
    tools = await storage.get_tool_configurations(tenant_id=ctx.tenant_id)
    return [ToolConfigurationResponse.model_validate(t) for t in tools]

@router.post("/", status_code=201)
async def create_tool(body: ToolConfigurationCreate, ctx: TenantContext = Depends(get_tenant_context)):
    doc = body.model_dump()
    doc["tenant_id"] = ctx.tenant_id  # Штампуем tenant_id из JWT
    await storage.save_tool_configuration(doc)
    ...

@router.put("/{tool_id}")
async def update_tool(tool_id: str, body: ..., ctx: TenantContext = Depends(get_tenant_context)):
    existing = await storage.get_tool_configuration(tool_id)
    # Проверка владения: нельзя менять чужие
    if existing.get("tenant_id") not in (ctx.tenant_id, "__system__"):
        raise HTTPException(403, "Access denied")
    if ctx.role != "root" and existing.get("tenant_id") == "__system__":
        raise HTTPException(403, "Cannot modify system config")
    ...
```

### Паттерн 5: Root видит всё

```python
@router.get("/users")
async def list_users(user: dict = Depends(require_role("tenant_admin"))):
    if user["role"] == "root":
        users = await storage.get_users()           # все
    else:
        users = await storage.get_users(tenant_id=user["tenant_id"])  # только свои
    ...
```

---

## Тенантная изоляция в Storage

### MongoDB-запросы с tenant_id

```python
# В mongo_backend.py — запрос с $or фильтром:
async def get_tool_configurations(self, tenant_id: str = None):
    query = {}
    if tenant_id:
        query["$or"] = [
            {"tenant_id": tenant_id},
            {"tenant_id": "__system__"},  # системные конфиги видны всем
        ]
    return await self.tool_configurations.find(query).to_list(None)
```

### Специальные tenant_id

| tenant_id | Значение |
|-----------|----------|
| `__system__` | Системные конфиги (seeded agents/workflows/tools), видны всем тенантам, кроме workflow: их видит только root (поправка 2026-10-09 к ADR 0002) |
| `__root__` | Корневой тенант, создаётся при первом запуске |
| любой другой | Пользовательский тенант (например, `acme-corp`) |

### Индексы

Все коллекции с tenant_id должны иметь индекс:
```python
await self.collection.create_index("tenant_id")
```

---

## Bootstrap (первый запуск)

При старте (`src/api/main.py`, lifespan):

1. Если нет тенантов → создаёт `__root__`
2. Если нет пользователей + есть env `SYNAPSE_ROOT_EMAIL` / `SYNAPSE_ROOT_PASSWORD` → создаёт root user

```python
# Env-переменные для bootstrap:
SYNAPSE_ROOT_EMAIL=admin@example.com
SYNAPSE_ROOT_PASSWORD=yourpassword
```

---

## Тестирование

### Мок-подход (без motor/MongoDB)

В тестах используется `MockStorageBackend` из `conftest.py` + API-stub чтобы не импортировать `motor`:

```python
# Создаём stub модуль чтобы api.main не тянул motor
_api_stub = types.ModuleType("api")
_api_stub.main = types.ModuleType("api.main")
_api_stub.main.app = None
sys.modules.setdefault("api", _api_stub)
sys.modules.setdefault("api.main", _api_stub.main)
```

### JWT в тестах

```python
from api.auth.utils import create_access_token, hash_password

# Создаём токен для тестового пользователя
token = create_access_token(user_id="test-user", tenant_id="test-tenant", role="root")
headers = {"Authorization": f"Bearer {token}"}
```

### Тенантная проверка в тестах

```python
# Пользователь tenant-A НЕ видит данные tenant-B
resp = await client.get("/api/tool-configurations", headers=tenant_a_headers)
tools = resp.json()
assert all(t["tenant_id"] in ("tenant-a", "__system__") for t in tools)
```

---

## Postman-коллекции

Файлы в `code/postman/`:
- `Synapse.postman_environment.json` — общий environment (synapse_url, токены)
- `Synapse-Auth.postman_collection.json` — Auth + Users + RBAC Tests
- `Synapse-Tenants.postman_collection.json` — Tenants + Settings

Каждая коллекция содержит auto-refresh скрипт: при 401 автоматически обновляет ACCESS_TOKEN через `/api/auth/refresh`.

---

## Чеклист при создании нового защищённого эндпоинта

1. [ ] Импортировать `Depends`, `TenantContext`, `get_tenant_context` (или `require_auth` / `require_role`)
2. [ ] Добавить `ctx: TenantContext = Depends(get_tenant_context)` в параметры
3. [ ] При **создании** — штамповать `doc["tenant_id"] = ctx.tenant_id`
4. [ ] При **чтении** — передавать `tenant_id=ctx.tenant_id` в storage-запрос
5. [ ] При **обновлении/удалении** — проверять `existing["tenant_id"] == ctx.tenant_id`
6. [ ] Root (`ctx.role == "root"`) — может обходить тенантные ограничения
7. [ ] `__system__` конфиги — доступны для чтения всем (кроме workflow: их читает только root), для записи только root
8. [ ] Добавить тест в `test_multitenancy.py` — проверить изоляцию между тенантами
9. [ ] Добавить запрос в соответствующую Postman-коллекцию
