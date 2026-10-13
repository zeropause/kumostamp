// Secrets: `.dev.vars` locally, `npx wrangler secret put <NAME>` in production.
interface Env {
  MAL_CLIENT_ID: string;
  MAL_CLIENT_SECRET: string;
  /** 32 random bytes, base64. Encrypts third-party tokens at rest. */
  TOKEN_KEY: string;
}
