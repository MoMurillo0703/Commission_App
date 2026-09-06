"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

type PreviewItem = {
  commissionId: number;
  paidMonth: string;
  groupName: string;
  carrierName: string;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  original: { label: string; agencyCents: number; agencyNetCents: number };
  proposed: {
    allocationId: number;
    allocationLabel: string;
    recipients: Array<{ recipientType: string; name: string; splitPercent: string; compensationCents: number }>;
    agencyCents: number;
    agencyNetCents: number;
    recipientPayableCents: number;
  } | null;
  blockedReason: string | null;
};

type PreviewResponse = {
  items: PreviewItem[];
  totals: {
    grossCents: number;
    originalAgencyCents: number;
    proposedRecipientPayableCents: number;
    resultingAgencyCents: number;
  };
  correctableIds: number[];
  previewToken: string | null;
};

export function CompensationCorrectionDialog({
  commissionIds,
  confirmationKey,
  onClose,
  onCorrected,
}: {
  commissionIds: number[];
  confirmationKey: string;
  onClose: () => void;
  onCorrected: (commissionIds: number[]) => void;
}) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchWithDeadline("/api/compensation-corrections/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commissionIds }),
        });
        const body = await readApiJson<PreviewResponse & { message?: string }>(response);
        if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
        if (!cancelled) setPreview(body);
      } catch (loadError) {
        if (!cancelled) setError(requestFailureMessage(loadError, "Unable to preview the compensation correction."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commissionIds]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    await runBusyAction(setBusy, async () => {
      setError("");
      const response = await fetchWithDeadline("/api/compensation-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commissionIds,
          reason,
          confirmationKey,
          previewToken: preview?.previewToken,
        }),
      });
      const body = await readApiJson<{ commissionIds?: number[]; message?: string }>(response);
      if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
      onCorrected(body.commissionIds ?? commissionIds);
    }).catch((confirmError) => {
      setError(requestFailureMessage(confirmError, "Unable to correct compensation."));
    });
  }

  const correctable = preview?.correctableIds ?? [];
  const blocked = preview?.items.filter((item) => item.blockedReason) ?? [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="correction-title" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Authorized correction</p>
        <h2 id="correction-title">Correct Compensation</h2>
        <p>This replaces the original Agency 100% fallback payout with the allocation that covers the original paid month. The original settlement is kept in audit history and is not a second financial transaction.</p>
        {!preview && !error && <p>Loading preview…</p>}
        {preview && (
          <>
            {preview.items.map((item) => (
              <article key={item.commissionId} className="allocation-card">
                <p><strong>Commission {item.commissionId}</strong> · {formatStatementMonth(item.paidMonth)} · {item.groupName} · {item.carrierName} · {item.lineOfBusinessName}</p>
                <p>Gross commission {formatCents(item.grossCommissionCents)}</p>
                <p>Original settlement: {item.original.label} · Agency {formatCents(item.original.agencyCents)} · Agency Net {formatCents(item.original.agencyNetCents)}</p>
                {item.proposed ? (
                  <div>
                    <p>Proposed settlement uses allocation {item.proposed.allocationId} ({item.proposed.allocationLabel})</p>
                    <table>
                      <thead>
                        <tr>
                          <th>Recipient</th>
                          <th>Type</th>
                          <th>Split</th>
                          <th>Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.proposed.recipients.map((recipient, index) => (
                          <tr key={`${recipient.recipientType}-${recipient.name}-${index}`}>
                            <td>{recipient.name}</td>
                            <td>{recipient.recipientType}</td>
                            <td>{recipient.splitPercent}</td>
                            <td>{formatCents(recipient.compensationCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>Agency share {formatCents(item.proposed.agencyCents)} · resulting Agency Net {formatCents(item.proposed.agencyNetCents)}</p>
                  </div>
                ) : (
                  <p className="form-error">{item.blockedReason}</p>
                )}
              </article>
            ))}
            <p>
              Totals · gross {formatCents(preview.totals.grossCents)} · original Agency {formatCents(preview.totals.originalAgencyCents)} · proposed recipient payable {formatCents(preview.totals.proposedRecipientPayableCents)} · resulting Agency {formatCents(preview.totals.resultingAgencyCents)}
            </p>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <form className="form-grid" onSubmit={(event) => void confirm(event)}>
          <label className="full">
            Correction reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} rows={3} />
          </label>
          <label className="full">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I reviewed the original and proposed settlements and authorize this correction.
          </label>
          <div className="form-actions full">
            <button type="submit" disabled={busy || !confirmed || !preview?.previewToken || correctable.length === 0 || blocked.length > 0 || correctable.length !== commissionIds.length}>
              {busy ? "Correcting…" : `Confirm correction of ${correctable.length} commission${correctable.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
