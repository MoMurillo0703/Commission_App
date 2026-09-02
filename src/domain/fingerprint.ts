import { createHash } from "node:crypto";

export function fingerprintBuffer(contents: ArrayBuffer | Uint8Array) {
  const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  return createHash("sha256").update(bytes).digest("hex");
}
