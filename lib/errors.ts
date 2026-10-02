export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do this") =>
  new ApiError(403, "forbidden", message);
export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, "unprocessable", message, details);
export const tooManyRequests = (retryAfterSec: number) =>
  new ApiError(429, "rate_limited", "Too many requests, try again later", {
    retryAfterSec,
  });
