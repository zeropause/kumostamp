/* Small Web Crypto helpers: random tokens, hashes for stored secrets, and token encryption. */

const toB64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

/** URL-safe random string; `bytes` of entropy. 32 bytes gives 43 characters. */
export function randomToken(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Hex SHA-256. Sessions and device tokens are looked up by this, never stored raw. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    const raw = fromB64(secret);
    if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64-encoded.");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(secret, key);
  }
  return key;
}

/** AES-GCM; the result is "iv.ciphertext" in base64url. */
export async function encrypt(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plain));
  return `${toB64url(iv)}.${toB64url(new Uint8Array(data))}`;
}

export async function decrypt(secret: string, sealed: string): Promise<string> {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(secret), fromB64(data));
  return new TextDecoder().decode(plain);
}
