import scss from "./disabledPage.module.scss";

const DisabledPage = () => (
  <main className={scss.root}>
    <h1>Раздел временно недоступен</h1>
    <p>
      Сейчас в Synapse Research доступны работа с документами и исследования. Ранее
      сохранённые исследования остаются в истории команды.
    </p>
    <a href="/documents">Перейти к документам</a>
    <a href="/researches">Открыть исследования</a>
  </main>
);

export default DisabledPage;
