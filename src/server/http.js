export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function data(res, value, status = 200) {
  return res.status(status).json({ data: value });
}

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "validation_error", "Invalid request", result.error.flatten());
  }
  return result.data;
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      error: { code: "invalid_json", message: "Request body must be valid JSON" }
    });
  }

  const status = error instanceof HttpError ? error.status : 500;
  const body = {
    code: error instanceof HttpError ? error.code : "internal_error",
    message: error instanceof HttpError ? error.message : "An unexpected error occurred"
  };
  if (error instanceof HttpError && error.details) body.details = error.details;
  if (!(error instanceof HttpError)) console.error(error);
  return res.status(status).json({ error: body });
}
