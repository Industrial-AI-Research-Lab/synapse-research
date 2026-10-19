# PAV Evidence Navigator

Repository contains two independently runnable applications.

- `frontend/` is React + TypeScript + Vite. Apply `.agents/skills/pav-frontend-core` for any frontend work and `pav-frontend-feature` for a user-facing change.
- `backend/` is FastAPI with Clean Architecture. Apply `.agents/skills/pav-backend-clean-architecture` before changing API, use cases, infrastructure or domain rules.

Do not restore server-rendered static UI in the backend. The only shared contract is the versionless REST API under `/api`.

Toast notifications default to the top-right corner through the shared `ToastViewport`. Preserve safe-area offsets and responsive sizing; do not add page-specific placement overrides.

Сохранять единый стиль кнопок: использовать общий `Button`, существующие токены и состояния hover/active/focus. Текстовые кнопки — капсулы с `--radius-control`; компактные кнопки только с иконкой — круглые, как скачивание источника (32 px, на сенсорных устройствах 44 px). Перед изменением кнопки сравнить её с аналогичными действиями на той же странице; не вводить отдельное локальное скругление или оформление для уже существующего типа действия.

Иконки компактных действий обновления и скачивания — 16 px. Отступ обводки фокуса кнопок — 3 px. При смене подписи на состояние загрузки сохранять размеры кнопки через общий `Button`; не скрывать его измерительный слой с помощью `display: none`. Общие кнопки закрытия уведомлений и переключения меню также используют круглую форму с `--radius-control` и сохраняют область нажатия 44 px.
