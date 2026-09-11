import { peopleCompensationOptions } from "@/domain/personCompensationModel";
import { allocationTotals } from "@/domain/allocations";
import { parsePercentToBps } from "@/domain/money";
import type { PersonIdentity } from "@/domain/agencyOwner";
import type { AccountManager, Agent } from "@/db/schema";

export type PeopleSplitRow = {
  personKind: "agent" | "account_manager";
  personId: string;
  percent: string;
};

export function PeopleSplitEditor({
  people,
  agents,
  accountManagers,
  owner,
  onChange,
}: {
  people: PeopleSplitRow[];
  agents: Agent[];
  accountManagers: AccountManager[];
  owner: PersonIdentity | null;
  onChange: (people: PeopleSplitRow[]) => void;
}) {
  const options = peopleCompensationOptions({ agents, accountManagers, owner });
  const selected = new Set(people.map((row) => `${row.personKind}:${row.personId}`).filter((key) => !key.endsWith(":")));
  const allocated = allocationTotals(people.map((row) => {
    try {
      return { compensationBps: parsePercentToBps(row.percent || "0") };
    } catch {
      return { compensationBps: 0 };
    }
  }));

  function update(index: number, patch: Partial<PeopleSplitRow>) {
    onChange(people.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  }

  return (
    <div className="full">
      <table className="recipient-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Split %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {people.map((row, index) => (
            <tr key={`${row.personKind}-${index}`}>
              <td>
                <select
                  aria-label={`Recipient ${index + 1}`}
                  value={row.personId ? `${row.personKind}:${row.personId}` : ""}
                  onChange={(event) => {
                    const [personKind, personId] = event.target.value.split(":");
                    update(index, {
                      personKind: personKind === "account_manager" ? "account_manager" : "agent",
                      personId: personId ?? "",
                    });
                  }}
                >
                  <option value="">Select person</option>
                  {options.map((option) => {
                    const key = `${option.personKind}:${option.personId}`;
                    const taken = selected.has(key) && key !== `${row.personKind}:${row.personId}`;
                    return (
                      <option key={key} value={key} disabled={taken}>
                        {option.label}
                      </option>
                    );
                  })}
                </select>
              </td>
              <td>
                <input
                  aria-label={`Split percent ${index + 1}`}
                  value={row.percent}
                  onChange={(event) => update(index, { percent: event.target.value })}
                  inputMode="decimal"
                />
              </td>
              <td>
                {people.length > 1 && (
                  <button type="button" className="secondary" onClick={() => onChange(people.filter((_, itemIndex) => itemIndex !== index))}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="secondary"
          disabled={people.length >= 6}
          onClick={() => onChange([...people, { personKind: "agent", personId: "", percent: "" }])}
        >
          Add person
        </button>
        <p>{allocated.complete ? "Total 100%" : `Allocated ${(allocated.allocatedBps / 100).toFixed(allocated.allocatedBps % 100 === 0 ? 0 : 2)}% · must total 100%`}</p>
      </div>
    </div>
  );
}
