import { parseDollarsToCents, parsePercentToBps } from "@/domain/money";
import { emptyToNull } from "./validation";

export function parseOptionalDollars(value: string | null | undefined) {
  const text = emptyToNull(value);
  return text ? parseDollarsToCents(text) : null;
}

export function parseOptionalPercent(value: string | null | undefined) {
  const text = emptyToNull(value);
  return text ? parsePercentToBps(text) : null;
}
