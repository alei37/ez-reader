import type { Locale } from "../../core/types/Locale";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../core/ports/TranslationProvider";

/**
 * Google Cloud Translation v3 implementation. Authentication uses a service
 * account JSON key that the user pastes into the plugin settings. We sign a
 * short-lived JWT (RS256) on the fly, swap it for an OAuth 2 access token via
 * Google's token endpoint, and call the REST `projects.translateText` API.
 *
 * References:
 *   https://cloud.google.com/translate/docs/reference/rest/v3/projects/translateText
 *   https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * The port intentionally hides API specifics; callers only see a string.
 * We make no attempt to support the legacy v2 `?key=` API.
 */
interface GoogleServiceAccount {
  readonly type: string;
  readonly project_id: string;
  readonly private_key: string;
  readonly client_email: string;
  readonly private_key_id?: string;
}

interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
  readonly error?: string;
  readonly error_description?: string;
}

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_TRANSLATE_HOST = "https://translation.googleapis.com";

/**
 * Cached access tokens keyed by service-account email. Cloud Translation v3
 * tokens last an hour; we cache until 5 minutes before expiry.
 */
interface TokenCacheEntry {
  readonly token: string;
  readonly expiresAt: number;
}

const TOKEN_CACHE = new Map<string, TokenCacheEntry>();
const SAFETY_WINDOW_MS = 5 * 60 * 1000;

export class GoogleTranslationProvider implements TranslationProvider {
  readonly id = "google-translation-v3";
  readonly displayName = "Google Translate (Cloud v3)";

  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const creds = JSON.parse(apiKey) as Partial<GoogleServiceAccount>;
      if (!creds.client_email || !creds.private_key) {
        return { ok: false, reason: "Service account JSON must contain client_email and private_key." };
      }
      if (creds.type && creds.type !== "service_account") {
        return { ok: false, reason: `Unexpected service account type: ${creds.type}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "API key must be a JSON service account key from Google Cloud." };
    }
  }

  async translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    const creds = this.parseCredentials(apiKey);
    if (!creds) {
      throw new Error("Google API key 格式不正确,需要完整的 service account JSON。");
    }
    const projectId = creds.project_id;
    if (!projectId) {
      throw new Error("Service account JSON 缺少 project_id 字段。");
    }
    const sourceCode = this.toGoogleLocale(request.source);
    const targetCode = this.toGoogleLocale(request.target);

    const accessToken = await this.getAccessToken(creds);
    const url = `${GOOGLE_TRANSLATE_HOST}/v3/projects/${encodeURIComponent(projectId)}:translateText`;
    const body: Record<string, unknown> = {
      contents: [request.text],
      mimeType: "text/plain",
      targetLanguageCode: targetCode
    };
    // Google treats an omitted sourceLanguageCode as "auto-detect".
    if (sourceCode) body.sourceLanguageCode = sourceCode;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
          "x-goog-user-project": projectId
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(`网络请求失败: ${this.formatError(error)}`);
    }

    let payload: GoogleTranslateResponse | GoogleErrorResponse;
    try {
      payload = (await response.json()) as GoogleTranslateResponse | GoogleErrorResponse;
    } catch (error) {
      throw new Error(`Google 返回了非 JSON 响应 (HTTP ${response.status}): ${this.formatError(error)}`);
    }
    if (!response.ok) {
      throw new Error(this.formatHttpError(response.status, payload, projectId));
    }
    const ok = payload as GoogleTranslateResponse;
    const first = ok.translations?.[0];
    if (!first) {
      throw new Error("Google 返回了空的翻译结果。");
    }
    return {
      text: first.translatedText,
      detectedSource: first.detectedLanguageCode ?? null,
      providerId: this.id
    };
  }

  private parseCredentials(apiKey: string): GoogleServiceAccount | null {
    const trimmed = apiKey.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as Partial<GoogleServiceAccount>;
      if (
        typeof parsed.client_email === "string" &&
        typeof parsed.private_key === "string" &&
        typeof parsed.project_id === "string"
      ) {
        return parsed as GoogleServiceAccount;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Exchange a freshly-signed JWT for a Cloud Translation access token. The
   * JWT is the standard RS256 service-account grant with a 1-hour lifetime;
   * we cache the resulting token per service-account email.
   */
  private async getAccessToken(creds: GoogleServiceAccount): Promise<string> {
    const cached = TOKEN_CACHE.get(creds.client_email);
    const now = Date.now();
    if (cached && cached.expiresAt - SAFETY_WINDOW_MS > now) {
      return cached.token;
    }
    const jwt = await this.signServiceAccountJwt(creds);
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt
        }).toString()
      });
    } catch (error) {
      throw new Error(`Google 鉴权请求失败: ${this.formatError(error)}`);
    }
    let payload: GoogleTokenResponse;
    try {
      payload = (await response.json()) as GoogleTokenResponse;
    } catch (error) {
      throw new Error(`Google 鉴权返回了非 JSON 响应 (HTTP ${response.status}): ${this.formatError(error)}`);
    }
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description ?? payload.error ?? "unknown";
      throw new Error(`Google 鉴权失败 (HTTP ${response.status}): ${detail}`);
    }
    const ttlMs = (payload.expires_in ?? 3600) * 1000;
    TOKEN_CACHE.set(creds.client_email, {
      token: payload.access_token,
      expiresAt: now + ttlMs
    });
    return payload.access_token;
  }

  /**
   * Sign a short-lived RS256 JWT carrying the service-account identity.
   *
   * Header:   { alg: "RS256", typ: "JWT", kid: <private_key_id> }
   * Payload:  { iss: <client_email>, sub: <client_email>,
   *             scope: cloud-platform, iat, exp }
   *
   * `exp - iat` is capped at 1 hour per the Google docs.
   */
  private async signServiceAccountJwt(creds: GoogleServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: creds.private_key_id ?? ""
    };
    const payload = {
      iss: creds.client_email,
      sub: creds.client_email,
      // Cloud Translation only needs cloud-platform scope.
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600
    };
    const headerB64 = base64urlEncode(JSON.stringify(header));
    const payloadB64 = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await importPrivateKey(creds.private_key);
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    );
    const signatureB64 = base64urlEncodeBytes(new Uint8Array(signature));
    return `${signingInput}.${signatureB64}`;
  }

  private toGoogleLocale(locale: Locale): string | null {
    if (locale === "auto" || locale === "") return null;
    // Google accepts BCP-47 codes (`zh-CN`, `en-US`, `pt-BR`) directly.
    return locale;
  }

  private formatHttpError(status: number, body: GoogleTranslateResponse | GoogleErrorResponse, projectId: string): string {
    const message =
      "error" in body && body.error?.message ? body.error.message : "Unknown error from Google Cloud Translation.";
    switch (status) {
      case 400:
        return `Google 请求参数错误: ${message}`;
      case 401:
      case 403:
        return `Google 鉴权/权限失败 (HTTP ${status}): ${message}。请确认 service account 拥有 roles.cloudtranslate.user (或更高) 在项目 ${projectId} 上。`;
      case 404:
        return `Google 找不到项目 ${projectId},或 Cloud Translation API 未启用: ${message}`;
      case 429:
        return `Google 配额超限: ${message}`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `Google 服务暂时不可用 (HTTP ${status}): ${message}`;
      default:
        return `Google HTTP 错误 ${status}: ${message}`;
    }
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

interface GoogleTranslateResponse {
  readonly translations?: ReadonlyArray<{
    readonly translatedText: string;
    readonly detectedLanguageCode?: string;
    readonly model?: string;
  }>;
}

interface GoogleErrorResponse {
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly status?: string;
  };
}

/**
 * Decode the PKCS#8 PEM string from the service-account JSON into a
 * WebCrypto key suitable for RSASSA-PKCS1-v1_5 with SHA-256.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!body) {
    throw new Error("Service account private_key 字段为空。");
  }
  const binary = base64ToBytes(body);
  return crypto.subtle.importKey(
    "pkcs8",
    toStandaloneBuffer(binary),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Wrap a Uint8Array in a fresh, definitely-not-shared ArrayBuffer. Strict
 * TypeScript DOM lib types treat Uint8Array<ArrayBufferLike> as not
 * assignable to BufferSource because the buffer might be a SharedArrayBuffer.
 */
function toStandaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function base64urlEncode(input: string): string {
  return base64urlEncodeBytes(new TextEncoder().encode(input));
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
