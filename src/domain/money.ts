const moneyPattern = /^-?\d+(?:\.\d{1,2})?$/;
const percentPattern = /^\d+(?:\.\d{1,2})?$/;

function unsignedToCents(unsigned: string) {
  const [dollars, fraction = ""] = unsigned.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parseDollarsToCents(value: string) {
  const trimmed = value.trim().replace(/[$,\s]/g, "");
  if (!trimmed) throw new Error("Amount is required.");
  if (!moneyPattern.test(trimmed)) throw new Error("Enter a valid dollar amount with up to two decimal places.");
  const negative = trimmed.startsWith("-");
  const cents = unsignedToCents(negative ? trimmed.slice(1) : trimmed);
  return negative ? -cents : cents;
}

export function centsToDollarString(cents: number) {
  if (!Number.isInteger(cents)) throw new Error("Money must be stored as integer cents.");
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatCents(cents: number, fractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(centsToDollarString(cents)));
}

export function parsePercentToBps(value: string) {
  const trimmed = value.trim().replace(/%/g, "");
  if (!trimmed) throw new Error("Percent is required.");
  if (!percentPattern.test(trimmed)) throw new Error("Enter a valid percent between 0 and 100.");
  const [whole, fraction = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 10000) throw new Error("Compensation percent cannot exceed 100.");
  return bps;
}

export function bpsToPercentString(bps: number) {
  if (!Number.isInteger(bps)) throw new Error("Compensation must be stored as integer basis points.");
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
