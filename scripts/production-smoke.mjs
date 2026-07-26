const rawUrl = process.env.SITE_URL;
if (!rawUrl) throw new Error("SITE_URL is required");

const siteUrl = new URL(rawUrl);
if (siteUrl.protocol !== "https:") {
  throw new Error("SITE_URL must use HTTPS");
}

const healthResponse = await fetch(new URL("/api/health", siteUrl), {
  headers: { accept: "application/json" }
});
if (!healthResponse.ok) {
  throw new Error(`Health check failed with ${healthResponse.status}`);
}
const health = await healthResponse.json();
if (health?.data?.status !== "ok") {
  throw new Error("Health response was not healthy");
}
if (healthResponse.headers.get("x-powered-by")) {
  throw new Error("Server technology header must remain disabled");
}
if (healthResponse.headers.get("cache-control") !== "no-store") {
  throw new Error("API responses must not be cached");
}

const pageResponse = await fetch(siteUrl);
if (!pageResponse.ok) {
  throw new Error(`Application page failed with ${pageResponse.status}`);
}
const page = await pageResponse.text();
if (!page.includes("Queen City Maid Operations")) {
  throw new Error("Application page did not contain the expected title");
}

console.log(`Production smoke check passed for ${siteUrl.origin}`);
