import { fingerprintBuffer } from "./fingerprint";
import { stableJson, type CorrectionAuthorizedTerms } from "./compensationCorrection";

function sha256Hex(value: string) {
  return fingerprintBuffer(new TextEncoder().encode(value));
}

export function correctionPreviewToken(terms: CorrectionAuthorizedTerms) {
  return sha256Hex(stableJson({
    commissions: [...terms.commissions].sort((left, right) => left.commissionId - right.commissionId),
  }));
}

export function correctionRequestFingerprint(input: {
  commissionIds: number[];
  previewToken: string;
  reason: string;
  termsHash: string;
}) {
  return sha256Hex(stableJson({
    commissionIds: [...input.commissionIds].sort((left, right) => left - right),
    previewToken: input.previewToken,
    reason: input.reason.trim(),
    termsHash: input.termsHash,
  }));
}
