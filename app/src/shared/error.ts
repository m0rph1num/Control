interface ErrorLike {
  userMessage?: unknown;
  message?: unknown;
  code?: unknown;
  details?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function errorText(error: unknown): string {
  if (typeof error === "string") {
    return error.trim() || "Неизвестная ошибка";
  }
  if (error instanceof Error) {
    return error.message.trim() || "Неизвестная ошибка";
  }
  if (isObject(error)) {
    const value = error as ErrorLike;
    if (typeof value.userMessage === "string" && value.userMessage.trim()) {
      return value.userMessage.trim();
    }
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
    if (typeof value.code === "string" && value.code.trim()) {
      return `Код ошибки: ${value.code.trim()}`;
    }
  }
  return "Неизвестная ошибка";
}

export function errorCode(error: unknown): string | null {
  if (isObject(error)) {
    const value = error as ErrorLike;
    if (typeof value.code === "string" && value.code.trim()) return value.code.trim();
  }
  return null;
}

export function errorDetails(error: unknown): Record<string, unknown> | null {
  if (isObject(error)) {
    const value = (error as ErrorLike).details;
    if (isObject(value)) return value;
  }
  return null;
}
