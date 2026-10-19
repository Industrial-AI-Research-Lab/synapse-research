import type { ResearchApproval } from "../../assets/types/research";

export const approvalRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try {
      return approvalRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export const approvalText = (value: unknown) =>
  typeof value === "string" ? value : "";

export const approvalItems = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const hasSameDocumentNames = (
  documents: unknown[],
  sources: { filename: string }[],
) => {
  const names = documents.map((item) =>
    approvalText(approvalRecord(item).filename),
  );
  if (!names.length || names.some((name) => !name)) return false;
  return (
    JSON.stringify(names.sort()) ===
    JSON.stringify(sources.map((source) => source.filename).sort())
  );
};

export const APPROVAL_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  title: "Название",
  description: "Описание",
  purpose: "Назначение",
  formula: "Формула",
  expression: "Выражение",
  inputs: "Входные данные",
  outputs: "Результаты",
  parameters: "Параметры",
  variables: "Переменные",
  unit: "Единица измерения",
  units: "Единицы измерения",
  value: "Значение",
  type: "Тип",
  label: "Подпись",
  required: "Обязательное поле",
  default: "По умолчанию",
  min: "Минимум",
  max: "Максимум",
  assumptions: "Допущения",
  limitations: "Ограничения",
  evidence: "Основания",
  references: "Ссылки на источники",
  source_ids: "Источники",
  observation_ids: "Наблюдения",
  candidate: "Расчёт",
  reason: "Причина",
  status: "Статус",
  calculator_id: "ID калькулятора",
  specification: "Спецификация",
  spec: "Спецификация",
};

const APPROVAL_COPY: Record<
  string,
  { title: string; description: string; confirmLabel: string }
> = {
  approve_manifest: {
    title: "Запрос и документы",
    description:
      "Подтвердите запрос и состав документов, чтобы продолжить исследование.",
    confirmLabel: "Подтвердить и продолжить",
  },
  approve_ontology: {
    title: "Структура данных",
    description:
      "Проверьте подготовленную структуру и ограничения. После подтверждения начнётся извлечение фактов из документов.",
    confirmLabel: "Подтвердить структуру",
  },
  approve_calculators: {
    title: "Расчётные инструменты",
    description:
      "Проверьте предложенные расчёты и их ограничения перед сборкой калькуляторов.",
    confirmLabel: "Подтвердить калькуляторы",
  },
  publish_report: {
    title: "Публикация отчёта",
    description:
      "Проверьте подготовленный отчёт перед публикацией HTML-версии.",
    confirmLabel: "Опубликовать отчёт",
  },
};

export const getApprovalPresentation = (approval: ResearchApproval) => {
  const details = approvalRecord(approval.details);
  const data = approval.expectedData ?? details;
  const gate = approvalText(data.gate_node_id);
  const snapshot = approvalRecord(data.context_snapshot);
  const custom = approvalRecord(snapshot.custom);
  const result = approvalRecord(approvalRecord(data.agent_result).output);
  const output = Object.keys(result).length
    ? result
    : approvalRecord(
        custom[
          gate === "approve_ontology"
            ? "ontology_result"
            : "calculator_proposals"
        ],
      );
  const proposals = approvalItems(output.proposals);
  const hasNoCalculators =
    gate === "approve_calculators" &&
    Array.isArray(output.proposals) &&
    output.proposals.length === 0;
  const copy = hasNoCalculators
    ? {
        title: "Для калькуляторов недостаточно данных",
        description:
          "Synapse не предложил расчётные инструменты. Проверьте причины и решите, можно ли продолжить без них.",
        confirmLabel: "Продолжить без калькуляторов",
      }
    : Object.hasOwn(APPROVAL_COPY, gate)
      ? APPROVAL_COPY[gate]
      : undefined;
  const nextSteps = approvalRecord(data.next_steps);
  const reject = approvalRecord(nextSteps.reject);
  const approve = approvalRecord(nextSteps.approve);
  const returnsForRevision =
    Boolean(approvalText(data.refine_target_node_id)) &&
    reject.node_id === data.refine_target_node_id &&
    reject.type === "phase";
  const prompt =
    approvalText(custom.user_prompt) || approvalText(snapshot.user_prompt);
  const questionStart = prompt.indexOf("Вопрос пользователя:");
  const question =
    questionStart >= 0
      ? prompt
          .slice(questionStart + "Вопрос пользователя:".length)
          .split("\nВложенные документы:")[0]
          .trim()
      : prompt;

  return {
    gate,
    title: copy?.title ?? "Требуется ваше решение",
    description:
      copy?.description ??
      "Проверьте данные запроса перед подтверждением или отклонением.",
    confirmLabel: copy?.confirmLabel ?? "Подтвердить",
    rejectLabel: returnsForRevision
      ? "На доработку"
      : gate === "publish_report"
        ? "Отклонить публикацию"
        : "Отклонить",
    returnsForRevision,
    approveTarget: approvalText(approve.label),
    rejectTarget: approvalText(reject.label),
    rejectionEndsRun: reject.type === "end",
    question,
    documents: approvalItems(custom.project_attachments),
    output,
    proposals,
    hasNoCalculators,
    data,
    originalContent: copy ? "" : approval.content,
  };
};
