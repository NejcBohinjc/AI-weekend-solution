// Typed access to environment variables. See .env.example for the full list.

/** Public base URL of the app, used to build setup links. No trailing slash. */
export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url.replace(/\/+$/, "");
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** The shared demo password. Only meaningful when DEMO_MODE=true. */
export function demoPassword(): string | null {
  const pw = process.env.DEMO_PASSWORD;
  return isDemoMode() && pw ? pw : null;
}
