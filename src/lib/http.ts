import { NextResponse } from "next/server";
import { z } from "zod";
import { ConflictError, NotFoundError, StatementBlockedError, ValidationError } from "./errors";

export function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

export function isDatabaseTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  return code === "57014"
    || /CONNECT_TIMEOUT|canceling statement due to statement timeout|statement timeout/i.test(error.message);
}

export function isDatabaseUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /ECONNREFUSED|ENOTFOUND|ECONNRESET|connection terminated|remaining connection slots/i.test(error.message);
}

export function toErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ message: error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  if (error instanceof StatementBlockedError) {
    return NextResponse.json({ message: error.message, blockers: error.blockers }, { status: 400 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ message: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ message: error.message, existing: error.existing ?? null }, { status: 409 });
  }
  if (error instanceof Error && /valid dollar|valid percent|integer cents|between 0 and 100/i.test(error.message)) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
  if (isDatabaseTimeoutError(error)) {
    return NextResponse.json({ message: "The database request timed out. Try again." }, { status: 504 });
  }
  if (isDatabaseUnavailableError(error)) {
    return NextResponse.json({ message: "The database is temporarily unavailable. Try again." }, { status: 503 });
  }
  return NextResponse.json({ message: "Something went wrong." }, { status: 500 });
}
