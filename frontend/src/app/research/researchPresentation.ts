export const RESEARCH_STATUS_LABELS: Record<string, string> = {
  starting: "Передаётся в Synapse",
  started: "Запущено",
  initialized: "Подготовка",
  queued: "Ожидает запуска",
  pending: "Ожидает запуска",
  running: "В работе",
  in_progress: "В работе",
  awaiting_approval: "Требуется решение",
  completed: "Завершено",
  done: "Завершено",
  output: "Результат подготовлен",
  failed: "Ошибка исследования",
  error: "Ошибка исследования",
  cancelled: "Отменено",
  canceled: "Отменено",
  rejected: "Отклонено",
  stopped: "Остановлено",
  start_failed: "Не удалось запустить",
  start_unknown: "Статус запуска неизвестен",
};

export const formatResearchStatus = (status: string) =>
  Object.hasOwn(RESEARCH_STATUS_LABELS, status)
    ? RESEARCH_STATUS_LABELS[status]
    : "Статус неизвестен";

export const formatResearchResultHint = (status: string) => {
  if (["completed", "done"].includes(status))
    return "Исследование завершено. Если итоговый отчёт ещё не появился, обновите состояние. Доступные материалы показаны ниже.";
  if (["failed", "error"].includes(status))
    return "Synapse завершил исследование с ошибкой и не подготовил итоговый ответ. Подробности доступны в Synapse; после проверки можно подготовить новый запуск.";
  if (["cancelled", "canceled", "rejected", "stopped"].includes(status))
    return "Исследование остановлено без итогового ответа. Проверьте причину в Synapse перед новым запуском.";
  if (status === "start_failed")
    return "Исследование не было запущено. Проверьте сообщение об ошибке и подготовьте новый запуск.";
  if (status === "start_unknown")
    return "Результат отправки неизвестен. Проверьте историю в Synapse перед повторным запуском.";
  return "Полный ответ появится здесь, когда Synapse подготовит результат. Можно закрыть страницу и вернуться позже.";
};

export const isResearchFinal = (status: string) =>
  [
    "completed",
    "done",
    "failed",
    "error",
    "cancelled",
    "canceled",
    "rejected",
    "stopped",
    "start_failed",
    "start_unknown",
  ].includes(status);

export const shouldAutoRefreshResearch = (
  status: string,
  isAutoMode = false,
) => !isResearchFinal(status) && (isAutoMode || status !== "awaiting_approval");

export const formatResearchDate = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(date))
    : "Ещё не проверялось";

const RESEARCH_PHASE_LABELS: Record<string, string> = {
  planning: "Подготовка исследования",
  requirements: "Уточнение запроса",
  execution: "Выполнение исследования",
  approve_manifest: "Согласование запроса и документов",
  design_ontology: "Подготовка структуры данных",
  approve_ontology: "Согласование структуры данных",
  extract_facts: "Извлечение фактов",
  assemble_collection: "Сборка коллекции",
  analyze_collection: "Анализ коллекции",
  design_calculators: "Проектирование калькуляторов",
  approve_calculators: "Согласование калькуляторов",
  build_calculators: "Сборка калькуляторов",
  render_report: "Подготовка отчёта",
  publish_report: "Публикация отчёта",
};

export const formatResearchPhase = (phase: string) =>
  RESEARCH_PHASE_LABELS[phase] ?? phase.replaceAll("_", " ");
