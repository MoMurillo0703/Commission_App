import { parseCaliforniaChoiceMonth } from "./dates";
import { moneyToken } from "./pdfExtraction";

const currencySymbol = /^\$+$|^\(\$\)$/;
const rateValue = /^\d{1,2}\.\d{1,2}%?$|^\d{1,2}%$/;
const structuralLob = /^(group(\s*(number|name|#))?|company(\s*name)?|paid month|product|paid premium|premium|comm(ission)?(\s*%|\s*amount)?|adj(\.?|\s*cd)|page(\s+\d+.*)?|subtotal|sub-total|total|grand total|california\s*choice|cal(\s*ifornia)?\s*choice)$/i;

export function isCurrencySymbol(value: string | null | undefined) {
  return currencySymbol.test(value?.trim() ?? "");
}

export function isRateValue(value: string | null | undefined) {
  return rateValue.test(value?.trim() ?? "");
}

export function isImpossibleLobCandidate(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) return true;
  if (isCurrencySymbol(text)) return true;
  if (moneyToken.test(text.replace(/\s/g, ""))) return true;
  if (parseCaliforniaChoiceMonth(text) != null) return true;
  if (isRateValue(text)) return true;
  if (/^\d{4,8}$/.test(text)) return true;
  if (structuralLob.test(text)) return true;
  return false;
}
