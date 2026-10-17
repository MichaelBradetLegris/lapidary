import type { RequestChannel, RequestPayload, ResponsePayload } from '../../shared/ipc';
import type { AppError, ErrorCode } from '../../shared/types';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.detail = error.detail;
  }
}

/** Invoke a main-process handler and unwrap the result envelope. */
export async function call<C extends RequestChannel>(
  channel: C,
  payload: RequestPayload<C>
): Promise<ResponsePayload<C>> {
  if (typeof window.api?.invoke !== 'function') {
    throw new ApiError({
      code: 'unknown',
      message: 'The preload bridge is missing. This page is only usable inside the app window.'
    });
  }
  const result = await window.api.invoke(channel, payload);
  if (result.ok) return result.value;
  throw new ApiError(result.error);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
