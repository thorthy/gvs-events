export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado`);
export const badRequest = (msg, details) => new HttpError(400, msg, details);
