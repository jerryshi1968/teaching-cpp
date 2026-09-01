export class AppError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const fail = (status, code, message, details) => { throw new AppError(status, code, message, details); };
export function assert(value, status, code, message, details) {
  if (!value) fail(status, code, message, details);
}
