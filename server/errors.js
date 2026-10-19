export class ApiError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code) => new ApiError(400, message, code);
export const unauthorized = (message = 'Connexion requise.', code) => new ApiError(401, message, code);
export const forbidden = (message = "Vous n'avez pas l'autorisation d'effectuer cette action.", code) =>
  new ApiError(403, message, code);
export const notFound = (message = 'Élément introuvable.') => new ApiError(404, message);
export const conflict = (message, code) => new ApiError(409, message, code);
export const tooMany = (message) => new ApiError(429, message, 'rate_limited');
