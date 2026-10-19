import scss from "./approvalSummary.module.scss";

import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Research, ResearchApproval } from "../../assets/types/research";
import {
  APPROVAL_FIELD_LABELS,
  approvalItems,
  approvalRecord,
  approvalText,
  getApprovalPresentation,
  hasSameDocumentNames,
} from "./approvalPresentation";

const readableValue = (value: unknown, depth = 0): ReactNode => {
  if (value == null) return "Не указано";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (depth >= 4) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value))
    return value.length ? (
      <ul className={scss.values}>
        {value.map((item, index) => (
          <li key={index}>{readableValue(item, depth + 1)}</li>
        ))}
      </ul>
    ) : (
      "Не указано"
    );
  return (
    <dl className={scss.fields}>
      {Object.entries(approvalRecord(value)).map(([key, item]) => (
        <div key={key}>
          <dt>
            {Object.hasOwn(APPROVAL_FIELD_LABELS, key)
              ? APPROVAL_FIELD_LABELS[key]
              : key}
          </dt>
          <dd>{readableValue(item, depth + 1)}</dd>
        </div>
      ))}
    </dl>
  );
};

const ApprovalSummary = ({
  approval,
  research,
  hasReport,
}: {
  approval: ResearchApproval;
  research: Pick<Research, "question" | "sources" | "files">;
  hasReport: boolean;
}) => {
  const view = getApprovalPresentation(approval);
  const ontology = approvalRecord(view.output.ontology);
  const index = approvalRecord(view.output.index);
  const coverage = approvalItems(view.output.coverage);
  const manifest = approvalItems(view.output.manifest);
  const gaps = approvalItems(view.output.gaps);
  const limitations = view.output.limitations;
  const hasLimitations =
    typeof limitations === "string"
      ? Boolean(limitations.trim())
      : Array.isArray(limitations)
        ? limitations.length > 0
        : Object.keys(approvalRecord(limitations)).length > 0;
  const limitationNote = hasLimitations && (
    <section className={scss.note}>
      <h3>
        {view.gate === "approve_ontology"
          ? "Ограничения подготовки"
          : view.hasNoCalculators
            ? "Результат проверки"
            : "Границы применения"}
      </h3>
      <div className={scss.noteContent}>{readableValue(limitations)}</div>
    </section>
  );
  const isQuestionShown = view.question.trim() === research.question.trim();
  const hasMatchingDocuments = hasSameDocumentNames(
    view.documents,
    research.sources,
  );
  const materials = [ontology, index].filter((item) =>
    approvalText(item.filename),
  );
  const hasListedMaterials = materials.some((item) =>
    research.files.some((file) => file.id === item.attachment_id),
  );
  const unlistedMaterials = materials.filter(
    (item) => !research.files.some((file) => file.id === item.attachment_id),
  );

  return (
    <div className={scss.root}>
      {view.gate === "approve_manifest" && (
        <>
          {!isQuestionShown && (
            <>
              <h3>
                {view.question
                  ? "Вопрос в согласовании отличается"
                  : "Вопрос для согласования"}
              </h3>
              <p className={scss.question}>
                {view.question ||
                  "Вопрос не передан в данных этого согласования."}
              </p>
            </>
          )}
          {!hasMatchingDocuments && (
            <>
              <h3>
                {view.documents.length
                  ? "Документы в согласовании отличаются"
                  : "Документы для согласования"}
              </h3>
              {view.documents.length ? (
                <ul className={scss.files}>
                  {view.documents.map((document, position) => (
                    <li key={position}>
                      {approvalText(approvalRecord(document).filename) ||
                        `Документ ${position + 1}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={scss.muted}>
                  Список документов не передан в данных этого согласования.
                </p>
              )}
            </>
          )}
        </>
      )}
      {view.gate === "approve_ontology" && (
        <>
          <dl className={scss.facts}>
            {approvalText(ontology.version) && (
              <div>
                <dt>Версия структуры</dt>
                <dd>{approvalText(ontology.version)}</dd>
              </div>
            )}
            {coverage.map((row, position) => (
              <Fragment key={position}>
                <div>
                  <dt>Проиндексировано</dt>
                  <dd>
                    {readableValue(approvalRecord(row).indexed_documents)} из{" "}
                    {readableValue(approvalRecord(row).approved_documents)}
                  </dd>
                </div>
                <div>
                  <dt>Фрагментов прочитано</dt>
                  <dd>{readableValue(approvalRecord(row).fragments_read)}</dd>
                </div>
              </Fragment>
            ))}
          </dl>
          {manifest.length > 0 &&
            !hasSameDocumentNames(manifest, research.sources) && (
              <>
                <h3>Документы в структуре</h3>
                <ul className={scss.files}>
                  {manifest.map((item, position) => (
                    <li key={position}>
                      {approvalText(approvalRecord(item).filename) ||
                        `Документ ${position + 1}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          {limitationNote}
          {materials.length > 0 && (
            <>
              <h3>Материалы для проверки</h3>
              {unlistedMaterials.length > 0 && (
                <ul className={scss.files}>
                  {unlistedMaterials.map((item, position) => (
                    <li key={position}>{approvalText(item.filename)}</li>
                  ))}
                </ul>
              )}
              {hasListedMaterials && (
                <a className={scss.detailsLink} href="#research-materials">
                  Открыть материалы структуры
                </a>
              )}
            </>
          )}
          {!Object.keys(view.output).length && (
            <p className={scss.muted}>
              Структурированное описание не передано. Проверьте полные данные
              ниже.
            </p>
          )}
        </>
      )}
      {view.gate === "approve_calculators" && (
        <>
          {view.proposals.length > 0 && (
            <ul className={scss.proposals}>
              {view.proposals.map((proposal, position) => {
                const fields = approvalRecord(proposal);
                const titleField = approvalText(fields.name)
                  ? "name"
                  : approvalText(fields.title)
                    ? "title"
                    : "";
                const title = approvalText(fields[titleField]);
                const formula = approvalText(fields.formula);
                const description = approvalText(fields.description);
                const inputs = Array.isArray(fields.inputs)
                  ? fields.inputs
                  : null;
                return (
                  <li key={position}>
                    <h3>
                      {approvalText(approvalRecord(proposal).name) ||
                        approvalText(approvalRecord(proposal).title) ||
                        `Расчётный инструмент ${position + 1}`}
                    </h3>
                    {formula && <p className={scss.formula}>{formula}</p>}
                    {description && <p>{description}</p>}
                    {inputs && (
                      <div className={scss.inputs}>
                        <span className={scss.muted}>Входные данные</span>
                        {inputs.length ? (
                          <ul className={scss.values}>
                            {inputs.map((input, inputPosition) => {
                              const item = approvalRecord(input);
                              const name =
                                approvalText(item.name) ||
                                approvalText(item.label);
                              const unit = approvalText(item.unit);
                              const extra = Object.fromEntries(
                                Object.entries(item).filter(
                                  ([key, value]) =>
                                    !(
                                      ["name", "label"].includes(key) &&
                                      value === name
                                    ) && !(key === "unit" && unit),
                                ),
                              );
                              return (
                                <li key={inputPosition}>
                                  {name && (
                                    <span>
                                      {name}
                                      {unit ? ` — ${unit}` : ""}
                                    </span>
                                  )}
                                  {!name && unit && <span>{unit}</span>}
                                  {Object.keys(extra).length
                                    ? readableValue(extra)
                                    : !name && !unit
                                      ? readableValue(input)
                                      : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className={scss.muted}>Не указано</p>
                        )}
                      </div>
                    )}
                    {readableValue(
                      Object.keys(fields).length
                        ? Object.fromEntries(
                            Object.entries(fields).filter(
                              ([key, value]) =>
                                !(key === "formula" && formula) &&
                                !(key === "description" && description) &&
                                !(key === "inputs" && inputs) &&
                                !(
                                  ["name", "title"].includes(key) &&
                                  value === title
                                ),
                            ),
                          )
                        : proposal,
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {gaps.length > 0 && (
            <>
              {view.proposals.length > 0 && (
                <h3>Чего не хватает для расчётов</h3>
              )}
              <ul className={scss.proposals}>
                {gaps.map((gap, position) => {
                  const fields = approvalRecord(gap);
                  const candidate = approvalText(fields.candidate);
                  const reason = approvalText(fields.reason);
                  const remaining = Object.fromEntries(
                    Object.entries(fields).filter(
                      ([key]) =>
                        !(key === "candidate" && candidate) &&
                        !(key === "reason" && reason),
                    ),
                  );
                  return (
                    <li key={position}>
                      {candidate && <h3>{candidate}</h3>}
                      {reason && <p className={scss.muted}>{reason}</p>}
                      {Object.keys(remaining).length > 0
                        ? readableValue(remaining)
                        : !candidate && !reason
                          ? readableValue(gap)
                          : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!Array.isArray(view.output.proposals) && (
            <p className={scss.muted}>
              Список предложений не передан. Проверьте полные данные ниже.
            </p>
          )}
          {limitationNote}
        </>
      )}
      {!["approve_ontology", "approve_calculators"].includes(view.gate) &&
        limitationNote}
      {view.gate === "publish_report" && (
        <>
          {hasReport ? (
            <a className={scss.detailsLink} href="#research-result">
              Открыть отчёт перед публикацией
            </a>
          ) : (
            <p className={scss.muted}>
              Предварительный просмотр отчёта пока недоступен. Проверьте данные
              публикации ниже и материалы исследования.
            </p>
          )}
          <section className={scss.note}>
            <h3>После подтверждения</h3>
            <p>
              Synapse выполнит публикацию. Адрес отчёта появится после её
              успешного завершения.
            </p>
          </section>
        </>
      )}
      {view.originalContent && (
        <p className={scss.original}>{view.originalContent}</p>
      )}
    </div>
  );
};

export default ApprovalSummary;
