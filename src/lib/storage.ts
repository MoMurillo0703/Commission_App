import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function safeName(originalFilename: string) {
  return originalFilename.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function objectKey(id: number, originalFilename: string) {
  return `statements/${id}-${safeName(originalFilename)}`;
}

function localDirectory() {
  return process.env.IMPORT_STORAGE_PATH ?? path.join(process.cwd(), "data", "imports");
}

function storageDriver() {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "supabase") return explicit;
  if (explicit === "local") {
    if (process.env.VERCEL) throw new Error("Local statement storage is not persistent on Vercel. Configure Supabase Storage.");
    return explicit;
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) return "supabase";
  if (process.env.VERCEL) throw new Error("Supabase Storage is required on Vercel. See DEPLOYMENT.md.");
  return "local";
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bucket() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "commission-statements";
}

export async function storeStatementFile(id: number, originalFilename: string, fileBuffer: Uint8Array) {
  const key = objectKey(id, originalFilename);
  if (storageDriver() === "supabase") {
    const { error } = await supabaseAdmin().storage.from(bucket()).upload(key, fileBuffer, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (error) throw new Error(`Unable to store the uploaded statement: ${error.message}`);
    return key;
  }

  const directory = localDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const storedPath = path.join(directory, path.basename(key));
  fs.writeFileSync(storedPath, fileBuffer);
  return storedPath;
}

export async function readStatementFile(storedPath: string) {
  if (storageDriver() === "supabase" || storedPath.startsWith("statements/")) {
    const { data, error } = await supabaseAdmin().storage.from(bucket()).download(storedPath);
    if (error || !data) throw new Error(error?.message ?? "Statement file was not found.");
    return Buffer.from(await data.arrayBuffer());
  }

  if (!fs.existsSync(storedPath)) throw new Error("Statement file was not found.");
  return fs.readFileSync(storedPath);
}

export function statementStoredPathBelongsTo(id: number, originalFilename: string, storedPath: string) {
  const key = objectKey(id, originalFilename);
  if (storedPath === key) return true;
  const expectedLocalPath = path.resolve(localDirectory(), path.basename(key));
  return path.resolve(storedPath) === expectedLocalPath;
}

export async function deleteStatementFile(id: number, originalFilename: string, storedPath: string | null | undefined) {
  const target = storedPath?.trim();
  if (!target) return;
  if (!statementStoredPathBelongsTo(id, originalFilename, target)) {
    throw new Error("The stored file path does not belong to this statement.");
  }

  if (storageDriver() === "supabase" || target.startsWith("statements/")) {
    const { error } = await supabaseAdmin().storage.from(bucket()).remove([target]);
    if (error) throw new Error(`Unable to delete the stored statement file: ${error.message}`);
    return;
  }

  if (!fs.existsSync(target)) return;
  try {
    fs.unlinkSync(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The stored statement file could not be removed.";
    throw new Error(`Unable to delete the stored statement file: ${message}`);
  }
}
