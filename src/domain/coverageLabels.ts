const coverageLabel = /^(medical|dental|vision|life|disability|pharmacy|rx|stop[\s-]?loss|vol(\.|untary)?|acc(ident)?|std|ltd|vis|med|den|chiro|chiropractic|medhmo)$/i;

export function isCoverageLabel(value: string | null | undefined) {
  return coverageLabel.test(value?.trim() ?? "");
}
