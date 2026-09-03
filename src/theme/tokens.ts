/**
 * Murillo Insurance suite theme.
 * Semantic tokens for Commission App and future shared applications.
 * Related, not identical, to Benefits Compliance.
 */
export const murilloTheme = {
  navy: "#15233B",
  navyDeep: "#0E1728",
  accent: "#C07A3A",
  accentText: "#8F4F1C",
  page: "#F4F5F7",
  surface: "#FFFFFF",
  border: "#E3E6EB",
  borderSubtle: "#ECEEF2",
  text: "#15233B",
  textMuted: "#5B6573",
  actionPrimary: "#15233B",
  actionPrimaryText: "#FFFFFF",
  actionSecondary: "#EEF1F5",
  actionSecondaryText: "#15233B",
  success: "#1B6B4A",
  successBg: "#E6F4EC",
  successText: "#14553A",
  warning: "#A86830",
  warningBg: "#F8EFE4",
  warningText: "#7A4A1E",
  error: "#8B3030",
  errorBg: "#F8E8E8",
  errorText: "#8B3030",
  navActive: "#243552",
  navActiveText: "#FFFFFF",
  tableHeader: "#3E4A5A",
  rowAlt: "#F7F8FA",
  sidebar: "#0E1728",
  sidebarText: "#D0D6E0",
  sidebarMuted: "#97A1B0",
  sidebarBorder: "#2A3548",
} as const;

export type MurilloThemeToken = keyof typeof murilloTheme;

export const murilloThemeAliases = {
  ink: murilloTheme.text,
  muted: murilloTheme.textMuted,
  green: murilloTheme.actionPrimary,
  mint: murilloTheme.actionSecondary,
  paper: murilloTheme.page,
  line: murilloTheme.border,
  white: murilloTheme.surface,
  amber: murilloTheme.warning,
} as const;

export function printableSuiteStyles() {
  const t = murilloTheme;
  return `
    body { font-family: Georgia, "Times New Roman", serif; color: ${t.text}; margin: 0; background: ${t.surface}; }
    .letterhead { border-bottom: 3px solid ${t.navy}; padding: 0 0 14px; margin-bottom: 18px; }
    .brand-mark { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 1px solid ${t.accent}; color: ${t.accentText}; border-radius: 6px; margin-right: 8px; font-weight: 700; }
    .agency { text-transform: uppercase; letter-spacing: .16em; font-size: 11px; font-weight: 700; color: ${t.accentText}; display: flex; align-items: center; }
    h1 { font-size: 24px; margin: 8px 0 4px; font-weight: 500; color: ${t.navy}; }
    .meta, .filters { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: ${t.textMuted}; }
    .filters { margin: 8px 0 16px; line-height: 1.6; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0 0 20px; }
    .summary div { font-family: Arial, Helvetica, sans-serif; background: ${t.rowAlt}; border: 1px solid ${t.border}; border-radius: 8px; padding: 10px 12px; }
    .summary span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: ${t.textMuted}; }
    .summary strong { display: block; margin-top: 6px; font-size: 16px; color: ${t.navy}; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
    thead { display: table-header-group; }
    th { text-align: left; border-bottom: 2px solid ${t.navy}; padding: 8px 8px; color: ${t.tableHeader}; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    td { border-bottom: 1px solid ${t.borderSubtle}; padding: 7px 8px; vertical-align: top; color: ${t.text}; }
    tr:nth-child(even) td { background: ${t.rowAlt}; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.neg { color: ${t.errorText}; font-weight: 700; }
    .group-label td { background: ${t.actionSecondary}; font-weight: 700; border-bottom: 1px solid ${t.navy}; color: ${t.navy}; }
    footer { margin-top: 22px; font-size: 10px; color: ${t.textMuted}; border-top: 1px solid ${t.border}; padding-top: 10px; }
  `.trim();
}
