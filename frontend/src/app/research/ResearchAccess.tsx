import scss from "./researchAccess.module.scss";

import { useEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
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
      inputRef.current?.focus();
      return;
    }
    setTeamAccessToken(code);
    onAccess();
  };

  const handleGetCode = async () => {
    if (isLoading) return;
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
            ref={inputRef}
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
              isLoading={isLoading}
              loadingLabel="Получаем код…"
              onClick={() => void handleGetCode()}
            >
              Подставить код стенда
            </Button>
          )}
        </div>
      </form>
    </section>
  );
};

export default ResearchAccess;
