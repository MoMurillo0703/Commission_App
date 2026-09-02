import { afterEach, describe, expect, it } from "vitest";
import { storeStatementFile } from "./storage";

const originalVercel = process.env.VERCEL;
const originalDriver = process.env.STORAGE_DRIVER;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("VERCEL", originalVercel);
  restore("STORAGE_DRIVER", originalDriver);
  restore("NEXT_PUBLIC_SUPABASE_URL", originalUrl);
  restore("SUPABASE_SERVICE_ROLE_KEY", originalServiceKey);
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
});
