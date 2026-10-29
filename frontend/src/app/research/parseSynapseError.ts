export const parseSynapseError = (error: string) => {
  const context =
    /^Synapse ([A-Z]+) (\/\S+): HTTP (\d{3})\.(?:\r?\n([\s\S]*))?$/.exec(error);
  const response = context ? (context[4] ?? "") : error;
  let message = response;
  let code = "";

  try {
    const payload: unknown = JSON.parse(response);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const details = payload as Record<string, unknown>;
      if (typeof details.detail === "string") message = details.detail;
      else if (typeof details.message === "string") message = details.message;
      if (typeof details.code === "string") code = details.code;
      else if (typeof details.error_type === "string")
        code = details.error_type;
    }
  } catch {
    // Synapse also returns ordinary text; it stays readable without JSON parsing.
  }

  return {
    message,
    code,
    method: context?.[1] ?? "",
    path: context?.[2] ?? "",
    httpStatus: context?.[3] ?? "",
  };
};
