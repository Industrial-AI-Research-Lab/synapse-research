import scss from "./researchAccess.module.scss";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getDocumentAccessCode,
  getDocumentAccessCodeAvailability,
} from "../../api/documents";
import { getTeamAccessToken, setTeamAccessToken } from "../../api/teamAccess";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import Input from "../../components/ui/Input/Input";

const ResearchAccess = ({ onAccess }: { onAccess: () => void }) => {
  const [code, setCode] = useState(getTeamAccessToken);
  const [canGetCode, setCanGetCode] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void getDocumentAccessCodeAvailability()
      .then((available) => {
        if (!isCancelled) setCanGetCode(available);
      })
      .catch(() => undefined);
    return () => {
      isCancelled = true;
    };
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      setError("Введите код команды.");
      return;
    }
    setTeamAccessToken(code);
    onAccess();
  };

  const handleGetCode = async () => {
    setIsLoading(true);
    setError("");
    try {
      setCode(await getDocumentAccessCode());
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Не удалось получить код.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className={scss.root} aria-labelledby="research-access-title">
      <h2 id="research-access-title">Откройте историю команды</h2>
      <p>
        Исследования могут содержать частные документы. Используйте тот же код
        команды, что и для работы с документами.
      </p>
      <form onSubmit={handleSubmit}>
        <Field label="Код команды" htmlFor="research-access-code" error={error}>
          <Input
            id="research-access-code"
            type="password"
            value={code}
            autoComplete="off"
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <div className={scss.actions}>
          <Button type="submit">Открыть историю</Button>
          {canGetCode && (
            <Button
              type="button"
              variant="secondary"
              disabled={isLoading}
              onClick={() => void handleGetCode()}
            >
              {isLoading ? "Получаем код…" : "Подставить код стенда"}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
};

export default ResearchAccess;
