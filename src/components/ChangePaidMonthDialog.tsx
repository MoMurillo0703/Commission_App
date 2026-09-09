"use client";

import { FormEvent, useState } from "react";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

type PreviewResponse = {
  statementId: number;
  statementName: string;
  carrierName: string | null;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissionCount: number;
  grossAffectedCents: number;
  payoutCount: number;
  confirmable: boolean;
  previewToken: string;
};

export function ChangePaidMonthDialog({
  statementId,
  currentPaidMonth,
  confirmationKey,
  onClose,
  onChanged,
}: {
  statementId: number;
  currentPaidMonth: string;
  confirmationKey: string;
  onClose: () => void;
  onChanged: (newPaidMonth: string) => void;
}) {
  const [newPaidMonth, setNewPaidMonth] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"choose" | "review">("choose");

  async function loadPreview() {
    setError("");
    await runBusyAction(setBusy, async () => {
      const response = await fetchWithDeadline(`/api/imports/statements/${statementId}/paid-month/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPaidMonth }),
      });
      const body = await readApiJson<PreviewResponse & { message?: string }>(response);
      if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
      setPreview(body);
      setStep("review");
    }).catch((loadError: unknown) => {
      setError(requestFailureMessage(loadError, "Unable to preview the paid-month change."));
    });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    setError("");
    await runBusyAction(setBusy, async () => {
      const response = await fetchWithDeadline(`/api/imports/statements/${statementId}/paid-month/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPaidMonth: preview.newPaidMonth,
          reason,
          confirmationKey,
          previewToken: preview.previewToken,
        }),
      });
      const body = await readApiJson<{ message?: string; newPaidMonth?: string }>(response);
      if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
      onChanged(preview.newPaidMonth);
    }).catch((confirmError: unknown) => {
      setError(requestFailureMessage(confirmError, "Unable to change paid month."));
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="paid-month-title" onClick={onClose}>
      <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={confirm}>
        <h2 id="paid-month-title">Change Paid Month</h2>
        {step === "choose" ? (
          <>
            <p>This moves the posted statement and its existing financial results to another reporting month. Compensation is not recalculated.</p>
            <label>
              Current Paid Month
              <input value={formatStatementMonth(currentPaidMonth)} readOnly />
            </label>
            <label>
              New Paid Month
              <input type="month" value={newPaidMonth} onChange={(event) => setNewPaidMonth(event.target.value)} required />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" disabled={busy || !newPaidMonth} onClick={() => void loadPreview()}>
                Preview
              </button>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : preview ? (
          <>
            <p><strong>{preview.statementName}</strong></p>
            <p>{formatStatementMonth(preview.currentPaidMonth)} → {formatStatementMonth(preview.newPaidMonth)}</p>
            <p>{preview.commissionCount} commissions</p>
            <p>{formatCents(preview.grossAffectedCents)} gross</p>
            <p><strong>Existing compensation:</strong> Preserved</p>
            <p><strong>Existing payouts:</strong> {preview.payoutCount} payout records preserved</p>
            <p><strong>Agency Net:</strong> Preserved</p>
            <p><strong>Coverage / Source Period:</strong> Unchanged</p>
            <p><strong>Compensation recalculation:</strong> None</p>
            <p>Changing Paid Month moves this statement and its existing financial results to the selected reporting month.</p>
            <label>
              Reason
              <input value={reason} onChange={(event) => setReason(event.target.value)} required />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="submit" disabled={busy || !preview.confirmable || !reason.trim()}>
                Confirm
              </button>
              <button type="button" className="secondary" onClick={() => { setStep("choose"); setPreview(null); }}>
                Back
              </button>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : null}
      </form>
    </div>
  );
}
