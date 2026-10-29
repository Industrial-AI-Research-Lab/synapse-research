import scss from "./disabledPage.module.scss";

const DisabledPage = () => (
  <main className={scss.root}>
    <h1>Раздел временно недоступен</h1>
    <p>
      Сейчас в Doc Research доступны запрос, источники и исследования. Ранее
      сохранённые исследования остаются в истории команды.
    </p>
    <a href="/documents">Перейти к запросу</a>
    <a href="/library">Открыть источники</a>
    <a href="/researches">Открыть исследования</a>
  </main>
);

export default DisabledPage;
