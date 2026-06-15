import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { execa } from "execa";
import fg from "fast-glob";

export type ZipSourceEntry = {
  entryName: string;
  sourcePath: string;
};

const cwd = process.cwd();

const ignore = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  ".tomorrowedge/**",
  "**/.tomorrowedge/**",
  ".runs/**",
  "**/.runs/**",
  ".vite/**",
  "**/.vite/**",
  "coverage/**",
  "output/**",
  "assignments/**",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.zip",
  "*.tgz",
  "*.tar",
  "*.tar.gz"
];

const cockpitWebAssetPatterns = [
  "dist/cockpit-web/index.html",
  "dist/cockpit-web/assets/*.js",
  "dist/cockpit-web/assets/*.css"
];

export async function runPackageZip(outputArg?: string): Promise<string> {
  const version = process.env.npm_package_version ?? "dev";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const output = path.resolve(outputArg ?? path.join(os.homedir(), "Desktop", `tomorrowedge-${version}-latest-${stamp}.zip`));

  await execa("npm", ["run", "secrets:scan"], { cwd, stdio: "inherit" });

  const sourceFiles = await fg(["**/*"], {
    cwd,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore
  });
  const cockpitWebFiles = await fg(cockpitWebAssetPatterns, {
    cwd,
    onlyFiles: true,
    followSymbolicLinks: false
  });
  assertCockpitWebAssetPaths(cockpitWebFiles);
  const files = [...new Set([...sourceFiles, ...cockpitWebFiles])];
  const entries = files.map((file) => ({
    entryName: toZipPath(path.posix.join("tomorrowedge", toZipPath(file))),
    sourcePath: path.join(cwd, file)
  }));
  assertNoEnvEntries(entries);
  assertNoLocalStateEntries(entries);
  assertCockpitWebZipEntries(entries.map((entry) => entry.entryName));

  await mkdir(path.dirname(output), { recursive: true });
  await rm(output, { force: true });
  await createZipArchive(output, entries);
  process.stdout.write(`Created ${output}\n`);
  return output;
}

export async function createZipArchive(outputPath: string, entries: ZipSourceEntry[]): Promise<void> {
  const chunks: Buffer[] = [];
  const centralDirectory: ZipCentralDirectoryEntry[] = [];
  let offset = 0;

  for (const entry of entries.sort((left, right) => left.entryName.localeCompare(right.entryName))) {
    const entryName = normalizeZipEntryName(entry.entryName);
    const data = await readFile(entry.sourcePath);
    const fileStat = await stat(entry.sourcePath);
    const compressed = deflateRawSync(data);
    const method = compressed.byteLength < data.byteLength ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const crc = crc32(data);
    const nameBytes = Buffer.from(entryName, "utf8");
    const { dosDate, dosTime } = toDosDateTime(fileStat.mtime);
    assertZip32(nameBytes.byteLength, "ZIP entry name");
    assertZip32(payload.byteLength, entryName);
    assertZip32(data.byteLength, entryName);
    assertZip32(offset, "ZIP offset");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(nameBytes.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBytes, payload);
    centralDirectory.push({
      entryName,
      nameBytes,
      method,
      dosDate,
      dosTime,
      crc,
      compressedSize: payload.byteLength,
      uncompressedSize: data.byteLength,
      localHeaderOffset: offset
    });
    offset += localHeader.byteLength + nameBytes.byteLength + payload.byteLength;
  }

  if (centralDirectory.length > 0xffff) throw new Error("ZIP archive has too many entries for the non-Zip64 writer.");

  const centralDirectoryOffset = offset;
  for (const entry of centralDirectory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.nameBytes.byteLength, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.localHeaderOffset, 42);
    chunks.push(header, entry.nameBytes);
    offset += header.byteLength + entry.nameBytes.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  assertZip32(centralDirectoryOffset, "ZIP central directory offset");
  assertZip32(centralDirectorySize, "ZIP central directory size");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  await writeFile(outputPath, Buffer.concat(chunks));
}

type ZipCentralDirectoryEntry = {
  entryName: string;
  nameBytes: Buffer;
  method: 0 | 8;
  dosDate: number;
  dosTime: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function toZipPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeZipEntryName(value: string): string {
  const normalized = toZipPath(value).replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid ZIP entry name: ${value}`);
  }
  return normalized;
}

function assertNoEnvEntries(entries: ZipSourceEntry[]): void {
  const hits = entries.filter((entry) => /(^|\/)\.env(\.|$)/.test(normalizeZipEntryName(entry.entryName)));
  if (hits.length) throw new Error(`Refusing to package .env files: ${hits.map((entry) => entry.entryName).join(", ")}`);
}

export function assertNoLocalStateEntries(entries: ZipSourceEntry[]): void {
  const stateDirs = new Set([".tomorrowedge", ".runs"]);
  const hits = entries.filter((entry) => normalizeZipEntryName(entry.entryName).split("/").some((part) => stateDirs.has(part)));
  if (hits.length) throw new Error(`Refusing to package local state: ${hits.map((entry) => entry.entryName).join(", ")}`);
}

export function assertCockpitWebZipEntries(entryNames: string[]): void {
  assertCockpitWebAssetPaths(entryNames.map((entry) => normalizeZipEntryName(entry).replace(/^tomorrowedge\//, "")));
}

function assertCockpitWebAssetPaths(paths: string[]): void {
  const normalized = paths.map(toZipPath);
  const hasIndex = normalized.includes("dist/cockpit-web/index.html");
  const hasScript = normalized.some((entry) => /^dist\/cockpit-web\/assets\/.+\.js$/.test(entry));
  const hasStyle = normalized.some((entry) => /^dist\/cockpit-web\/assets\/.+\.css$/.test(entry));
  const missing = [
    hasIndex ? undefined : "dist/cockpit-web/index.html",
    hasScript ? undefined : "dist/cockpit-web/assets/*.js",
    hasStyle ? undefined : "dist/cockpit-web/assets/*.css"
  ].filter((entry): entry is string => Boolean(entry));
  if (missing.length) throw new Error(`Refusing to package zip without cockpit-web assets: ${missing.join(", ")}`);
}

function assertZip32(value: number, label: string): void {
  if (value > 0xffffffff) throw new Error(`${label} exceeds the non-Zip64 archive limit.`);
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}

let crcTable: Uint32Array | undefined;

function crc32(data: Buffer): number {
  const table = crcTable ??= buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPackageZip(process.argv[2]);
}
