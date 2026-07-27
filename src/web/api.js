export class ApiError extends Error {
  constructor(message, status = 0, details = null, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "include",
      ...options,
      signal: options.signal || AbortSignal.timeout(30_000),
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new ApiError("The server took too long to respond. Please try again.");
    }
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message || body?.message || "The request could not be completed.",
      response.status,
      body?.error?.details || null,
      body?.error?.code || ""
    );
  }

  return body?.data ?? body;
}

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function sessionUser(payload) {
  const user = payload?.user ?? payload;
  return user?.role ? user : null;
}

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const api = {
  async me() {
    return sessionUser(await request("/auth/me"));
  },

  async login(email, password) {
    const user = sessionUser(await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }));
    return user || sessionUser(await request("/auth/me"));
  },

  logout() {
    return request("/auth/logout", { method: "POST" });
  },

  get(path, query) {
    return request(`${path}${queryString(query)}`);
  },

  post(path, body = {}) {
    return request(path, { method: "POST", body: JSON.stringify(body) });
  },

  patch(path, body) {
    return request(path, { method: "PATCH", body: JSON.stringify(body) });
  },

  remove(path) {
    return request(path, { method: "DELETE" });
  },

  list(resource, query) {
    return this.get(`/${resource}`, query);
  },

  create(resource, body) {
    return this.post(`/${resource}`, body);
  },

  update(resource, id, body) {
    return this.patch(`/${resource}/${id}`, body);
  },

  dashboard() {
    return this.get("/dashboard");
  },

  dispatch(date) {
    return this.get("/dispatch", { date });
  },

  myRoute(date) {
    return this.get("/my-route", { date });
  },

  reports(from, to) {
    return this.get("/reports/operations", { from, to });
  },

  settings() {
    return this.get("/settings");
  }
};
