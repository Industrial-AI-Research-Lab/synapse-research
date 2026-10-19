import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalRecord,
  getApprovalPresentation,
  hasSameDocumentNames,
} from "../src/app/research/approvalPresentation.ts";

const approval = (gate, extra = {}) => ({
  id: "approval-1",
  title: "Upstream title",
  content: "Please review and approve or reject.",
  details: { gate_node_id: gate, ...extra },
  expectedData: { gate_node_id: gate, ...extra },
});

test("repeated document lists compare visible filenames, independent of upload IDs and order", () => {
  const documents = [
    { id: "synapse-a", filename: "А.json" },
    { id: "synapse-b", filename: "Б.json" },
  ];
  const sources = [
    { id: "local-b", filename: "Б.json" },
    { id: "local-a", filename: "А.json" },
  ];
  const original = structuredClone({ documents, sources });
  assert.equal(hasSameDocumentNames(documents, sources), true);
  assert.deepEqual({ documents, sources }, original);
  assert.equal(hasSameDocumentNames(documents, sources.slice(0, 1)), false);
  assert.equal(
    hasSameDocumentNames(documents, [
      { filename: "А.json" },
      { filename: "В.json" },
    ]),
    false,
  );
  assert.equal(
    hasSameDocumentNames(
      [{ filename: "А.json" }, { filename: "А.json" }],
      sources,
    ),
    false,
  );
  assert.equal(
    hasSameDocumentNames(
      [{ filename: "А.json" }, { filename: "А.json" }],
      [{ filename: "А.json" }],
    ),
    false,
  );
  assert.equal(hasSameDocumentNames([{}], [{ filename: "" }]), false);
  assert.equal(hasSameDocumentNames([], []), false);
});

test("manifest uses the reviewed snapshot rather than the current research sources", () => {
  const source = approval("approve_manifest", {
    context_snapshot: {
      custom: {
        user_prompt:
          "Инструкция\n\nВопрос пользователя: Как влияет температура?\nВложенные документы: исходный.json",
        project_attachments: [{ id: "original", filename: "исходный.json" }],
      },
    },
  });
  const untouched = structuredClone(source);
  const view = getApprovalPresentation(source);
  assert.equal(view.title, "Запрос и документы");
  assert.equal(view.question, "Как влияет температура?");
  assert.deepEqual(view.documents, [
    { id: "original", filename: "исходный.json" },
  ]);
  assert.equal(view.originalContent, "");
  assert.deepEqual(source, untouched);
});

test("ontology reads actual agent output including zero coverage and limitations", () => {
  const output = {
    ontology: { version: "1.0.0" },
    coverage: [
      { fragments_read: 0, indexed_documents: 0, approved_documents: 3 },
    ],
    limitations: ["Нет экспериментальных наблюдений"],
  };
  const view = getApprovalPresentation(
    approval("approve_ontology", { agent_result: { output } }),
  );
  assert.equal(view.title, "Структура данных");
  assert.deepEqual(view.output, output);
});

test("calculator proposals and explicitly empty proposals produce different decisions", () => {
  const proposals = [
    { name: "Расчёт", inputs: [{ name: "Температура", unit: "K" }] },
  ];
  const proposed = getApprovalPresentation(
    approval("approve_calculators", {
      agent_result: { output: { proposals } },
    }),
  );
  assert.equal(proposed.title, "Расчётные инструменты");
  assert.equal(proposed.hasNoCalculators, false);
  assert.deepEqual(proposed.proposals, proposals);
  const empty = getApprovalPresentation(
    approval("approve_calculators", {
      agent_result: {
        output: {
          proposals: [],
          gaps: [{ candidate: "Расчёт", reason: "Нет данных" }],
        },
      },
    }),
  );
  assert.equal(empty.title, "Для калькуляторов недостаточно данных");
  assert.equal(empty.confirmLabel, "Продолжить без калькуляторов");
});

test("missing or malformed proposals never authorize continuing without calculators", () => {
  for (const proposals of [undefined, null, {}, "", "[]", false]) {
    const view = getApprovalPresentation(
      approval("approve_calculators", {
        agent_result: { output: { proposals } },
      }),
    );
    assert.equal(view.hasNoCalculators, false);
    assert.equal(view.confirmLabel, "Подтвердить калькуляторы");
  }
});

test("publication is identified by the node rather than deploy subtype or translated label", () => {
  const source = approval("publish_report", {
    gate_label: "Публикация HTML-отчёта",
  });
  source.title = "deploy";
  const view = getApprovalPresentation(source);
  assert.equal(view.title, "Публикация отчёта");
  assert.equal(view.confirmLabel, "Опубликовать отчёт");
  assert.equal(view.rejectLabel, "Отклонить публикацию");
});

test("revision wording requires the actual rejection edge to the refinement phase", () => {
  const extra = {
    refine_target_node_id: "design_ontology",
    next_steps: {
      reject: {
        node_id: "design_ontology",
        type: "phase",
        label: "Подготовка структуры",
      },
    },
  };
  assert.equal(
    getApprovalPresentation(approval("approve_ontology", extra)).rejectLabel,
    "На доработку",
  );
  extra.next_steps.reject.node_id = "end";
  extra.next_steps.reject.type = "end";
  const end = getApprovalPresentation(approval("approve_ontology", extra));
  assert.equal(end.rejectLabel, "Отклонить");
  assert.equal(end.rejectionEndsRun, true);
  assert.equal(
    getApprovalPresentation(approval("approve_ontology")).returnsForRevision,
    false,
  );
});

test("legacy saved details and context output remain readable without expectedData", () => {
  const source = approval("approve_calculators", {
    context_snapshot: { custom: { calculator_proposals: { proposals: [] } } },
  });
  delete source.expectedData;
  source.details = JSON.stringify(source.details);
  assert.equal(getApprovalPresentation(source).hasNoCalculators, true);
});

test("unknown gates, including inherited object keys, preserve the original message", () => {
  for (const gate of ["future_gate", "toString", "__proto__", ""]) {
    const source = approval(gate);
    const view = getApprovalPresentation(source);
    assert.equal(view.title, "Требуется ваше решение");
    assert.equal(view.originalContent, source.content);
    assert.equal(view.rejectLabel, "Отклонить");
  }
  for (const details of [null, [], false, "bad json", 0]) {
    assert.deepEqual(approvalRecord(details), {});
  }
});
