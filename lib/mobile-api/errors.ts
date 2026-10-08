export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, 'unauthorized', 'Sign in required.'),
  forbidden: () => new ApiError(403, 'forbidden', 'You do not have access to this.'),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  validation: (fields: Record<string, string>) =>
    new ApiError(400, 'validation_failed', 'Some fields are invalid.', fields),
  upgradeRequired: (min: string) =>
    new ApiError(426, 'app_update_required', `Please update the app to version ${min} or newer.`),
  idempotencyKeyRequired: () =>
    new ApiError(400, 'idempotency_key_required', 'An Idempotency-Key header is required for this request.'),
  idempotencyInProgress: () =>
    new ApiError(409, 'idempotency_in_progress', 'Try again shortly with the same Idempotency-Key.'),
  questIncomplete: () => new ApiError(409, 'quest_incomplete', 'Finish every quest step first.'),
  claimInProgress: () => new ApiError(409, 'claim_in_progress', 'This reward is being processed. Try again shortly.'),
  rewardUnavailable: () => new ApiError(503, 'reward_unavailable', 'This reward is unavailable right now.'),
  chatRateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'chat_rate_limited', 'Too many messages. Try again shortly.', { retryAfterSeconds: String(retryAfterSeconds) }),
  chatUnavailable: () => new ApiError(503, 'chat_unavailable', 'Support chat is unavailable right now.'),
}

export function errorBody(e: ApiError): {
  error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> }
} {
  return {
    error: {
      code: e.code,
      message: e.message,
      ...(e.fields ? { fields: e.fields } : {}),
      ...(e.details ? { details: e.details } : {}),
    },
  }
}
