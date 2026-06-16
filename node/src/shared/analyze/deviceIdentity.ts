import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonObject } from "../../step2-collect/types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

export type DeviceAuthTokenEntry = {
  token: string;
  role: string;
  scopes: string[];
};

function stateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  return path.resolve(override || path.join(os.homedir(), ".openclaw"));
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (
    Buffer.isBuffer(spki) &&
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return Buffer.from(spki);
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const filePath = path.join(stateDir(), "identity", "device.json");
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
      if (
        isObject(parsed) &&
        parsed.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // Fall through and generate a new identity.
  }

  const identity = generateIdentity();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ version: 1, deviceId: identity.deviceId, publicKeyPem: identity.publicKeyPem, privateKeyPem: identity.privateKeyPem, createdAtMs: Date.now() }, null, 2)}\n`,
    { encoding: "utf-8", mode: 0o600 },
  );
  return identity;
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

export function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    params.platform.trim().toLowerCase(),
    params.deviceFamily?.trim().toLowerCase() ?? "",
  ].join("|");
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf-8"), crypto.createPrivateKey(privateKeyPem)));
}

function deviceAuthPath(): string {
  return path.join(stateDir(), "identity", "device-auth.json");
}

function readDeviceAuthStore(): JsonObject | null {
  try {
    if (!fs.existsSync(deviceAuthPath())) return null;
    const parsed = JSON.parse(fs.readFileSync(deviceAuthPath(), "utf-8")) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadDeviceAuthToken(deviceId: string, role: string): DeviceAuthTokenEntry | null {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId || !isObject(store.tokens)) return null;
  const entry = store.tokens[role];
  if (!isObject(entry) || typeof entry.token !== "string") return null;
  return {
    token: entry.token,
    role: typeof entry.role === "string" ? entry.role : role,
    scopes: Array.isArray(entry.scopes) ? entry.scopes.map(String) : [],
  };
}

export function storeDeviceAuthToken(params: { deviceId: string; role: string; token: string; scopes: string[] }): void {
  const filePath = deviceAuthPath();
  const existing = readDeviceAuthStore();
  const tokens = existing?.deviceId === params.deviceId && isObject(existing.tokens) ? { ...existing.tokens } : {};
  tokens[params.role] = {
    token: params.token,
    role: params.role,
    scopes: [...new Set(params.scopes)].sort(),
    updatedAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, deviceId: params.deviceId, tokens }, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}
