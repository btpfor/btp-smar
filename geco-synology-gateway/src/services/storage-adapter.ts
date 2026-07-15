/**
 * Abstraction générique du stockage GECO (NAS Synology DS112).
 * Toutes les implémentations concrètes (Windows SMB natif, etc.)
 * doivent respecter ce contrat.
 */
export interface StorageHealth {
  nasAccessible: boolean;
  smbConnected: boolean;
  readAllowed: boolean;
  writeAllowed: boolean;
  message?: string;
}

export interface StorageStat {
  size: number;
  mtime: Date;
  isDirectory: boolean;
}

export interface DiskSpace {
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
}

export interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<StorageHealth>;
  list(rel: string): Promise<string[]>;
  read(rel: string): Promise<Buffer>;
  write(rel: string, data: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(rel: string): Promise<void>;
  stat(rel: string): Promise<StorageStat | null>;
  ensureFolder(rel: string): Promise<void>;
  getDiskSpace(): Promise<DiskSpace>;
}
