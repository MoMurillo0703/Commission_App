export function teamSavedMessage() {
  return "Team saved. It is available to use in a Group + LOB allocation.";
}

export function teamSaveErrorMessage(body: { message?: string } | null | undefined) {
  return body?.message?.trim() || "Unable to save team.";
}

export function teamAvailableForAllocation(
  teams: Array<{ name: string; status: string }>,
  savedName: string,
) {
  const needle = savedName.trim().toLowerCase();
  return teams.some((team) => team.status === "active" && team.name.trim().toLowerCase() === needle);
}

export async function runTeamSaveFlow<T extends { name: string; status: string }>(input: {
  request: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<{ teams: T[] }>;
  savedName: string;
}) {
  const response = await input.request();
  if (!response.ok) {
    return {
      error: teamSaveErrorMessage(response),
      success: null as string | null,
      teams: [] as T[],
      available: false,
      refreshed: false,
    };
  }
  const refreshed = await input.refresh();
  return {
    error: null as string | null,
    success: teamSavedMessage(),
    teams: refreshed.teams,
    available: teamAvailableForAllocation(refreshed.teams, input.savedName),
    refreshed: true,
  };
}
