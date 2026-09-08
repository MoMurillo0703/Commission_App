"use client";

import { FormEvent, useState } from "react";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

type ImpactItem = {
  commissionId: number;
  groupName: string;
  carrierName: string;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  coverageMonth: string | null;
  sourcePeriodLabel: string | null;
  payoutCount: number;
  impactClass: string;
  impactCode: string;
  blockedReason: string | null;
};

type PreviewResponse = {
  statementId: number;
  statementName: string;
  carrierName: string | null;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissionCount: number;
  commissionIds: number[];
  grossAffectedCents: number;
  recipientPayoutsAffected: number;
  historicalAllocationsAffected: number;
  reportsAffected: string[];
  items: ImpactItem[];
  confirmable: boolean;
  payoutCorrectionRequired: boolean;
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
        <p>This moves the entire posted statement to another agency-receipt month. Coverage and source periods stay unchanged. Posted statements are not deleted.</p>
        {step === "choose" ? (
          <>
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
                Preview Impact
              </button>
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : preview ? (
          <>
            <p><strong>Statement:</strong> {preview.statementName}</p>
            <p><strong>Carrier:</strong> {preview.carrierName || "—"}</p>
            <p><strong>Current Paid Month:</strong> {formatStatementMonth(preview.currentPaidMonth)}</p>
            <p><strong>New Paid Month:</strong> {formatStatementMonth(preview.newPaidMonth)}</p>
            <p><strong>Commission rows affected:</strong> {preview.commissionCount}</p>
            <p><strong>Gross affected:</strong> {formatCents(preview.grossAffectedCents)}</p>
            <p><strong>Recipient payouts affected:</strong> {preview.recipientPayoutsAffected}</p>
            <p><strong>Historical allocations affected:</strong> {preview.historicalAllocationsAffected}</p>
            <p><strong>Reports affected:</strong> {preview.reportsAffected.join("; ")}</p>
            <table>
              <thead>
                <tr>
                  <th>Commission</th>
                  <th>Group</th>
                  <th>Class</th>
                  <th>Coverage / Source</th>
                  <th>Gross</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.commissionId}>
                    <td>{item.commissionId}</td>
                    <td>{item.groupName}</td>
                    <td>{item.impactCode} {item.impactClass.replace(/_/g, " ")}</td>
                    <td>{item.coverageMonth || item.sourcePeriodLabel || "—"}</td>
                    <td>{formatCents(item.grossCommissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.items.some((item) => item.blockedReason) && (
              <p className="form-error">{preview.items.find((item) => item.blockedReason)?.blockedReason}</p>
            )}
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
