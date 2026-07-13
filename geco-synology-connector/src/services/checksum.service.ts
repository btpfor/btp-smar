import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(absPath: string): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}
