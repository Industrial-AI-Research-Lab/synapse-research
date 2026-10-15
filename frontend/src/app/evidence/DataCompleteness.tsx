import scss from "./dataCompleteness.module.scss";

import { useEffect, useMemo, useState } from "react";

import {
  createAnalysis,
  createSynapseProject,
  getEvidence,
} from "../../api/evidence";
import type {
  AnalysisAnswer,
  EvidenceResponse,
  EvidenceSummary,
} from "../../assets/types/evidence";
import Button from "../../components/ui/Button/Button";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Loader from "../../components/ui/Loader/Loader";
import { getAnalysisFlow } from "./analysisFlow";
import { ResearchApiError } from "../../api/research";
import { getTeamAccessToken, setTeamAccessToken } from "../../api/teamAccess";
import Field from "../../components/ui/Field/Field";
import Input from "../../components/ui/Input/Input";

interface AnalysisResultValue {
  answer: AnalysisAnswer;
  summary: EvidenceSummary;
  source_fragments: Array<{ experiment: string; excerpt: string }>;
}

type Result =
  | { title: string; value: AnalysisResultValue; kind: "analysis" }
  | { title: string; value: unknown; kind: "generic" };

const CONDITION_LABELS: Record<string, string> = {
  temperature_c: "Температура",
  salinity_g_l: "Минерализация",
  rock_type: "Материал образца",
  permeability_md: "Проницаемость",
};

const CONDITION_UNITS: Record<string, string> = {
  temperature_c: "°C",
  salinity_g_l: "г/л",
  permeability_md: "мД",
};

const formatConditionLabel = (condition: string) =>
  CONDITION_LABELS[condition] ?? condition.replaceAll("_", " ");

const formatConditionValue = (
  condition: string,
  value: string | number | null,
) => {
  if (value === null) return "Не указано";

  const unit = CONDITION_UNITS[condition];
  if (typeof value === "number" && unit) return `${value} ${unit}`;

  return String(value);
};

const getSafeCitationLink = (url: string) => {
  if (url.startsWith("/source/")) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
      return parsedUrl.toString();
    }
  } catch {
    // A malformed citation remains visible as text but must not become a link.
  }

  return undefined;
};

const getAnswerConclusion = (answer: AnalysisAnswer) => {
  if (answer.confirmed_facts.length === 0) {
    return "Для этого вопроса в выбранных материалах не найдено подтверждённых фактов.";
  }

  if (answer.comparison.direct_comparison_allowed) {
    return `В ответе использовано ${answer.confirmed_facts.length} подтверждённых фактов. Некоторые из выбранных опытов можно сопоставлять напрямую.`;
  }

  return `В ответе использовано ${answer.confirmed_facts.length} подтверждённых фактов. Их можно проверить по источникам, но прямое сопоставление выбранных опытов не подтверждено.`;
};

const DataCompleteness = () => {
  const [hasSynapseAccessError, setHasSynapseAccessError] = useState(false);
  const [teamCode, setTeamCode] = useState(getTeamAccessToken);
  const [flow] = useState(getAnalysisFlow);
  const [evidence, setEvidence] = useState<EvidenceResponse>();
  const [result, setResult] = useState<Result>();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!flow) {
      setIsLoading(false);
      return;
    }

    const loadDataCompleteness = async () => {
      try {
        const response = await getEvidence(flow.filters);
        setEvidence(response);
      } catch (error) {
        setResult({
          title: "Ошибка загрузки",
          value: error instanceof Error ? error.message : "Неизвестная ошибка.",
          kind: "generic",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void loadDataCompleteness();
  }, [flow]);

  const selectedItems = useMemo(() => {
    if (!evidence || !flow) return [];

    const selectedIds = new Set(flow.selectedIds);
    return evidence.items.filter((item) => selectedIds.has(item.id));
  }, [evidence, flow]);
  const missingFields = useMemo(
    () =>
      Array.from(new Set(selectedItems.flatMap((item) => item.missing_fields))),
    [selectedItems],
  );

  const handleBack = () => window.location.assign("/?restore-analysis=1");
  const handleAnalyse = async () => {
    if (!flow) return;

    setIsLoading(true);
    try {
      const response = await createAnalysis(flow.question, flow.selectedIds);
      setResult({
        title: "Ответ с доказательствами",
        kind: "analysis",
        value: {
          answer: response.answer,
          summary: response.summary,
          source_fragments: response.items.map((item) => ({
            experiment: item.id,
            excerpt: item.source.excerpt,
          })),
        },
      });
    } catch (error) {
      setResult({
        title: "Ошибка анализа",
        value: error instanceof Error ? error.message : "Неизвестная ошибка.",
        kind: "generic",
      });
    } finally {
      setIsLoading(false);
    }
  };
  const handleSynapse = async () => {
    if (!flow) return;

    setIsLoading(true);
    try {
      const project = await createSynapseProject(
        flow.question,
        flow.selectedIds,
      );
      if (project.research_id) {
        window.location.assign(
          `/researches/${encodeURIComponent(project.research_id)}`,
        );
        return;
      }
      setResult({
        title: "Проект Synapse",
        value: project,
        kind: "generic",
      });
    } catch (error) {
      setHasSynapseAccessError(
        error instanceof ResearchApiError && error.status === 401,
      );
      setResult({
        title: "Synapse недоступен",
        value: error instanceof Error ? error.message : "Неизвестная ошибка.",
        kind: "generic",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadJson = (value: AnalysisResultValue) => {
    const json = JSON.stringify(value, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = "pav-evidence-collection.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  if (!flow) {
    return (
      <main className={scss.root}>
        <article className={scss.panel}>
          <p className={scss.eyebrow}>Полнота данных</p>
          <h1>Сначала сформулируйте вопрос</h1>
          <p className={scss.muted}>
            Для проверки полноты нужны выбранные опыты и вопрос к ним.
          </p>
          <Button onClick={handleBack}>Вернуться к выбору опытов</Button>
        </article>
      </main>
    );
  }

  if (isLoading && !evidence && !result) {
    return (
      <main className={scss.root}>
        <Loader variant="page" label="Проверяем выбранные опыты…" />
      </main>
    );
  }

  return (
    <main className={scss.root}>
      <header className={scss.header}>
        <div>
          <p className={scss.eyebrow}>Шаг 2 из 2 · полнота данных</p>
          <h1>Какие сведения отсутствуют</h1>
          <p className={scss.lead}>
            Проверяем {selectedItems.length} из {flow.selectedIds.length}{" "}
            выбранных опытов перед подготовкой вывода.
          </p>
        </div>
        <div className={scss.headerActions}>
          <Button
            className={scss.changeQuestionButton}
            variant="secondary"
            onClick={handleBack}
          >
            <span className={scss.buttonIcon} aria-hidden="true">
              <IconRenderer icon="arrowLeft" />
            </span>
            Вернуться к настройке запроса
          </Button>
        </div>
      </header>

      <section className={scss.panel} aria-busy={isLoading}>
        <p className={scss.eyebrow}>Выбранные опыты</p>
        <h2>Полнота данных для вопроса</h2>
        <p className={scss.question}>{flow.question}</p>
        {isLoading && !evidence ? (
          <Loader
            variant="inline"
            label="Проверяем сведения в выбранных опытах…"
          />
        ) : (
          <ul className={scss.gaps}>
            {missingFields.length ? (
              missingFields.map((field) => <li key={field}>{field}</li>)
            ) : (
              <li>В выбранных опытах обязательные поля заполнены.</li>
            )}
          </ul>
        )}
      </section>

      <section className={scss.actions} aria-label="Следующие действия">
        <Button
          className={scss.collectEvidenceButton}
          variant="secondary"
          onClick={() => void handleAnalyse()}
          disabled={isLoading}
        >
          Собрать доказательства
          <span className={scss.buttonIcon} aria-hidden="true">
            <IconRenderer icon="analyticsReport" />
          </span>
        </Button>
        <Button
          className={scss.synapseButton}
          onClick={() => void handleSynapse()}
          disabled={isLoading}
        >
          Исследовать в Synapse
          <span className={scss.buttonIcon} aria-hidden="true">
            <IconRenderer icon="synapseResearch" />
          </span>
        </Button>
      </section>

      {hasSynapseAccessError && (
        <section className={scss.panel}>
          <h2>Код команды для исследования</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setTeamAccessToken(teamCode);
              void handleSynapse();
            }}
          >
            <Field label="Код команды" htmlFor="evidence-team-code">
              <Input
                id="evidence-team-code"
                type="password"
                autoComplete="off"
                value={teamCode}
                onChange={(event) => setTeamCode(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={isLoading}>
              Сохранить код и запустить исследование
            </Button>
          </form>
        </section>
      )}

      {result && (
        <section className={scss.result}>
          <p className={scss.eyebrow}>Результат</p>
          <div className={scss.resultHeader}>
            <h2>{result.title}</h2>
            {result.kind === "analysis" && (
              <button
                className={scss.downloadButton}
                type="button"
                aria-label="Скачать в JSON"
                title="Скачать в JSON"
                onClick={() => handleDownloadJson(result.value)}
              >
                <IconRenderer icon="download" />
              </button>
            )}
          </div>
          {result.kind === "analysis" ? (
            <div className={scss.analysisResult}>
              <section
                className={scss.conclusion}
                aria-labelledby="answer-conclusion-heading"
              >
                <h3 id="answer-conclusion-heading">Краткий вывод</h3>
                <p>{getAnswerConclusion(result.value.answer)}</p>
              </section>

              <section aria-labelledby="confirmed-facts-heading">
                <h3 id="confirmed-facts-heading">Подтверждённые факты</h3>
                {result.value.answer.confirmed_facts.length > 0 ? (
                  <ol className={scss.factList}>
                    {result.value.answer.confirmed_facts.map((fact) => {
                      const sourceFragment = result.value.source_fragments.find(
                        (fragment) =>
                          fragment.experiment === fact.experiment_id,
                      );
                      const citationLink = getSafeCitationLink(
                        fact.citation.url,
                      );

                      return (
                        <li key={fact.experiment_id} className={scss.factCard}>
                          <div className={scss.factHeader}>
                            <p className={scss.experimentId}>
                              Опыт {fact.experiment_id}
                            </p>
                            <p className={scss.factResult}>
                              <span>{fact.metric}</span>
                              <strong>
                                {fact.value} {fact.unit}
                              </strong>
                            </p>
                          </div>

                          <div>
                            <h4>Условия эксперимента</h4>
                            <dl className={scss.conditions}>
                              {Object.entries(fact.conditions).map(
                                ([condition, value]) => (
                                  <div key={condition}>
                                    <dt>{formatConditionLabel(condition)}</dt>
                                    <dd>
                                      {formatConditionValue(condition, value)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </div>

                          <div className={scss.citation}>
                            <h4>Источник</h4>
                            {citationLink ? (
                              <a
                                href={citationLink}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {fact.citation.document},{" "}
                                {fact.citation.location}
                              </a>
                            ) : (
                              <p>
                                {fact.citation.document},{" "}
                                {fact.citation.location}
                              </p>
                            )}
                            {sourceFragment && (
                              <blockquote>{sourceFragment.excerpt}</blockquote>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className={scss.emptyFacts}>
                    В ответе нет подтверждённых фактов, поэтому вывод делать
                    нельзя.
                  </p>
                )}
              </section>

              <section aria-labelledby="limitations-heading">
                <h3 id="limitations-heading">Ограничения ответа</h3>
                {result.value.answer.limitations.length > 0 ||
                result.value.answer.comparison.restricted_pairs.length > 0 ? (
                  <ul className={scss.limitationList}>
                    {result.value.answer.limitations.map((limitation) => (
                      <li key={`experiment-${limitation.experiment_id}`}>
                        <strong>Опыт {limitation.experiment_id}.</strong>{" "}
                        {limitation.reason}
                      </li>
                    ))}
                    {result.value.answer.comparison.restricted_pairs.map(
                      (pair) => (
                        <li key={`pair-${pair.left}-${pair.right}`}>
                          <strong>
                            Сопоставление {pair.left} и {pair.right}.
                          </strong>{" "}
                          {pair.reason}
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className={scss.noLimitations}>
                    Ограничений, связанных с неполнотой данных или статусом
                    сопоставимости, не обнаружено.
                  </p>
                )}
              </section>

              <dl className={scss.summary}>
                <div>
                  <dt>Всего опытов</dt>
                  <dd>{result.value.summary.total}</dd>
                </div>
                <div>
                  <dt>Сопоставимы</dt>
                  <dd>{result.value.summary.comparable}</dd>
                </div>
                <div>
                  <dt>Ограниченно сопоставимы</dt>
                  <dd>{result.value.summary.limited}</dd>
                </div>
                <div>
                  <dt>Не сопоставимы</dt>
                  <dd>{result.value.summary.not_comparable}</dd>
                </div>
              </dl>

              {result.value.summary.missing_fields.length > 0 && (
                <div>
                  <h3>Отсутствующие сведения</h3>
                  <ul className={scss.fieldList}>
                    {result.value.summary.missing_fields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.value.summary.warning && (
                <p className={scss.warning}>{result.value.summary.warning}</p>
              )}
            </div>
          ) : (
            <pre>
              {typeof result.value === "string"
                ? result.value
                : JSON.stringify(result.value, null, 2)}
            </pre>
          )}
        </section>
      )}
      {isLoading && evidence && (
        <Loader variant="overlay" label="Готовим результат анализа…" />
      )}
    </main>
  );
};

export default DataCompleteness;
