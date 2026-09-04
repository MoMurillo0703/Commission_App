export async function timedStage<T>(
  scope: "import-preview" | "import-persist",
  stage: string,
  extra: {
    statementId?: number | null;
    paidMonth?: string | null;
    rowCount?: number | null;
    unmatchedGroupCount?: number | null;
  },
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    console.info(JSON.stringify({
      scope,
      stage,
      ok: true,
      elapsedMs: Date.now() - started,
      statementId: extra.statementId ?? null,
      paidMonth: extra.paidMonth ?? null,
      rowCount: extra.rowCount ?? null,
      unmatchedGroupCount: extra.unmatchedGroupCount ?? null,
    }));
    return result;
  } catch (error) {
    console.info(JSON.stringify({
      scope,
      stage,
      ok: false,
      elapsedMs: Date.now() - started,
      statementId: extra.statementId ?? null,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    throw error;
  }
}
