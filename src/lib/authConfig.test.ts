import { afterEach, describe, expect, it } from "vitest";
import { isPublicAuthPath, registrationEnabled, signInErrorMessage } from "./authConfig";

const original = process.env.ENABLE_REGISTRATION;

afterEach(() => {
  if (original === undefined) delete process.env.ENABLE_REGISTRATION;
  else process.env.ENABLE_REGISTRATION = original;
});

describe("authentication configuration", () => {
  it("keeps login, password reset, and sign-out public", () => {
    expect(isPublicAuthPath("/login")).toBe(true);
    expect(isPublicAuthPath("/forgot-password")).toBe(true);
    expect(isPublicAuthPath("/reset-password")).toBe(true);
    expect(isPublicAuthPath("/auth/reset-password")).toBe(true);
    expect(isPublicAuthPath("/auth/signout")).toBe(true);
    expect(isPublicAuthPath("/statements")).toBe(false);
  });

  it("keeps registration disabled unless explicitly enabled", () => {
    delete process.env.ENABLE_REGISTRATION;
    expect(registrationEnabled()).toBe(false);
    process.env.ENABLE_REGISTRATION = "true";
    expect(registrationEnabled()).toBe(true);
  });

  it("translates common sign-in failures into clear messages", () => {
    expect(signInErrorMessage("Invalid login credentials")).toBe("Email or password is incorrect.");
    expect(signInErrorMessage(undefined)).toMatch(/email and password/i);
  });
});
