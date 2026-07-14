import { createHash } from "node:crypto";
import { Readable } from "node:stream";

/** SHA-256 en streaming — jamais de chargement complet en mémoire. */
export async function sha256Stream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
