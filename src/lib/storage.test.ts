import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteStatementFile, statementStoredPathBelongsTo, storeStatementFile } from "./storage";

const originalVercel = process.env.VERCEL;
const originalDriver = process.env.STORAGE_DRIVER;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalImportPath = process.env.IMPORT_STORAGE_PATH;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("VERCEL", originalVercel);
  restore("STORAGE_DRIVER", originalDriver);
  restore("NEXT_PUBLIC_SUPABASE_URL", originalUrl);
  restore("SUPABASE_SERVICE_ROLE_KEY", originalServiceKey);
  restore("IMPORT_STORAGE_PATH", originalImportPath);
});

describe("statement storage deployment safety", () => {
  it("does not fall back to ephemeral local storage on Vercel", async () => {
    process.env.VERCEL = "1";
    delete process.env.STORAGE_DRIVER;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(storeStatementFile(1, "statement.xlsx", new Uint8Array())).rejects.toThrow(
      /Supabase Storage is required on Vercel/,
    );
  });

  it("deletes only the local file that belongs to the statement", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commission-storage-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.IMPORT_STORAGE_PATH = directory;
    delete process.env.VERCEL;
    const first = await storeStatementFile(11, "a.xlsx", new Uint8Array([1, 2, 3]));
    const second = await storeStatementFile(12, "b.xlsx", new Uint8Array([4, 5, 6]));
    expect(statementStoredPathBelongsTo(11, "a.xlsx", first)).toBe(true);
    expect(statementStoredPathBelongsTo(11, "a.xlsx", second)).toBe(false);
    await deleteStatementFile(11, "a.xlsx", first);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(true);
    await expect(deleteStatementFile(11, "a.xlsx", second)).rejects.toThrow(/does not belong/);
    await expect(deleteStatementFile(11, "a.xlsx", path.join(directory, "elsewhere", path.basename(first)))).rejects.toThrow(/does not belong/);
    expect(fs.existsSync(second)).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
