import { createHash } from "crypto";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}