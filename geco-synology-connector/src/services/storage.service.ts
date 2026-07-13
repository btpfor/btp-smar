import { statfs, access, constants } from "node:fs/promises";
import { env } from "../config/env.js";

export interface StorageStatus {
  status: "available" | "unavailable";
  root: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  readable: boolean;
  writable: boolean;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const stats = await statfs(env.GECO_STORAGE_ROOT);
    const total = stats.blocks * stats.bsize;
    const available = stats.bavail * stats.bsize;
    const used = total - available;
    let readable = false;
    let writable = false;
    try {
      await access(env.GECO_STORAGE_ROOT, constants.R_OK);
      readable = true;
    } catch { /* noop */ }
    try {
      await access(env.GECO_STORAGE_ROOT, constants.W_OK);
      writable = true;
    } catch { /* noop */ }

    return {
      status: readable ? "available" : "unavailable",
      root: env.GECO_STORAGE_ROOT,
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      usagePercent: total > 0 ? +((used / total) * 100).toFixed(2) : 0,
      readable,
      writable,
    };
  } catch {
    return {
      status: "unavailable",
      root: env.GECO_STORAGE_ROOT,
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
      readable: false,
      writable: false,
    };
  }
}
