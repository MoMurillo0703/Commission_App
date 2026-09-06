import type { LineApplyMode } from "@/domain/allocationBulkApply";
import {
  coverageArrangementLabel,
  type GroupCoverageLine,
} from "@/domain/groupCoverage";

export function GroupCoverageTable({
  lines,
  modes,
  templateEntries,
  onToggle,
  onAgency,
  onChange,
  onDeactivate,
  onSelectNeedingSetup,
  onClearSelection,
}: {
  lines: GroupCoverageLine[];
  modes: Record<number, LineApplyMode>;
  templateEntries: Array<{
    recipientType: string;
    personKind?: string | null;
    personId?: number | null;
    teamId?: number | null;
    compensationBps: number;
  }>;
  onToggle: (lineOfBusinessId: number, selected: boolean, currentMode: LineApplyMode) => void;
  onAgency: (lineOfBusinessId: number) => void;
  onChange: (line: GroupCoverageLine) => void;
  onDeactivate: (allocationId: number) => void;
  onSelectNeedingSetup: () => void;
  onClearSelection: () => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="muted-note">This group does not yet have an active line of coverage on file from commissions, allocations, or agreements. Historical inactive lines stay in history and are not listed here.</p>
    );
  }
  return (
    <>
      <div className="form-actions" style={{ margin: "10px 0", flexWrap: "wrap" }}>
        <button type="button" className="secondary" onClick={onSelectNeedingSetup}>
          Select All Needing Setup
        </button>
        <button type="button" className="secondary" onClick={onClearSelection}>
          Clear Selection
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Apply</th>
            <th>Coverage</th>
            <th>Status</th>
            <th>Recipients</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const mode = modes[line.lineOfBusinessId] ?? (line.needsSetup ? "template" : "skip");
            const selected = mode !== "skip";
            return (
              <tr key={line.lineOfBusinessId}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${line.name}`}
                    checked={selected}
                    onChange={(event) => onToggle(line.lineOfBusinessId, event.target.checked, mode)}
                  />
                </td>
                <td><strong>{line.name}</strong></td>
                <td>{mode === "agency" && selected ? "Agency 100% / no recipient compensation" : coverageArrangementLabel(line, templateEntries)}</td>
                <td>{line.recipientSummary || "—"}</td>
                <td>
                  <div className="form-actions">
                    <button type="button" className="secondary" onClick={() => onAgency(line.lineOfBusinessId)}>
                      Agency 100%
                    </button>
                    {line.configured && line.allocationId != null && (
                      <button type="button" className="secondary" onClick={() => onChange(line)}>
                        Change
                      </button>
                    )}
                    {line.configured && line.allocationId != null && (
                      <button type="button" className="secondary" onClick={() => onDeactivate(line.allocationId!)}>
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
