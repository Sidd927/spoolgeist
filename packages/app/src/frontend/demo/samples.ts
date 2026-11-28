/**
 * SYNTHETIC demo reports. Every identifier, value and name is invented.
 * No real patient data. Hollowmere County Hospital and LABSYS/370 are fictional.
 * Written by Claude Code.
 */

export interface DemoReport {
  id: string;
  title: string;
  /** One-line explanation shown in the picker. */
  blurb: string;
  layoutHint: "cbc" | "bmp" | "lipid";
  expect: "accepted" | "refusal" | "review" | "layout-mismatch";
  lines: readonly string[];
}

const RULE = "================================================================";
const DASH = "----------------------------------------------------------------";

export const CBC_CLEAN: readonly string[] = [
  RULE,
  "HOLLOWMERE COUNTY HOSPITAL          LABSYS/370  RPT LAB-CBC-01",
  "HEMATOLOGY - COMPLETE BLOOD COUNT        ** SYNTHETIC DATA **",
  RULE,
  "PATIENT ID : SYN-00417          COLLECTED : 2026-10-31 23:47",
  "WARD       : 4 EAST             PRINTED   : 2026-11-01 00:12",
  DASH,
  "TEST                    RESULT   UNITS       REFERENCE",
  "HEMOGLOBIN (HGB)          13.5   g/dL        12.0 - 17.5",
  "WBC COUNT                  7.2   10^3/uL      4.0 - 11.0",
  "PLATELETS (PLT)            245   10^3/uL      150 - 450",
  "HEMATOCRIT (HCT)          41.0   %           36.0 - 52.0",
  DASH,
  "VERIFIED BY: TECH 07                         PAGE 1 OF 1",
  "*** END OF REPORT ***",
];

export const BMP_CLEAN: readonly string[] = [
  RULE,
  "HOLLOWMERE COUNTY HOSPITAL          LABSYS/370  RPT LAB-BMP-02",
  "CHEMISTRY - BASIC METABOLIC PANEL        ** SYNTHETIC DATA **",
  RULE,
  "PATIENT ID : SYN-00932          COLLECTED : 2026-10-30 06:05",
  "WARD       : ICU 2              PRINTED   : 2026-10-30 07:40",
  DASH,
  "TEST                    RESULT   UNITS       REFERENCE",
  "SODIUM (NA)                139   mmol/L       135 - 145",
  "POTASSIUM (K)              4.1   mmol/L       3.5 - 5.1",
  "GLUCOSE (GLU)               92   mg/dL         70 - 99",
  "CREATININE (CREAT)        0.94   mg/dL       0.60 - 1.30",
  DASH,
  "VERIFIED BY: TECH 03                         PAGE 1 OF 1",
  "*** END OF REPORT ***",
];

/** A different vendor format: the layout no rule knows yet. */
export const LIPID_ONBOARD: readonly string[] = [
  "HOLLOWMERE CTY HOSP - OUTREACH LAB              LIPID PROFILE",
  "SYNTHETIC TEST DATA - NOT A REAL PATIENT",
  "ACCT# SYN-77120    DRAWN 10/29/2026 0715    FASTING: Y",
  "",
  "  CHOLESTEROL, TOTAL ........ 212  mg/dL   REF <200",
  "  TRIGLYCERIDES ............. 148  mg/dL   REF <150",
  "  HDL CHOLESTEROL ...........  51  mg/dL   REF >40",
  "  LDL CHOLESTEROL (CALC) .... 131  mg/dL   REF <100",
  "",
  "COMMENT: FASTING SPECIMEN.",
  "-- END LIPID PROFILE --",
];

/** A later report of the same lipid layout: processed with zero AI after approval. */
export const LIPID_REPEAT: readonly string[] = [
  "HOLLOWMERE CTY HOSP - OUTREACH LAB              LIPID PROFILE",
  "SYNTHETIC TEST DATA - NOT A REAL PATIENT",
  "ACCT# SYN-77388    DRAWN 11/02/2026 0802    FASTING: Y",
  "",
  "  CHOLESTEROL, TOTAL ........ 187  mg/dL   REF <200",
  "  TRIGLYCERIDES ............. 102  mg/dL   REF <150",
  "  HDL CHOLESTEROL ...........  58  mg/dL   REF >40",
  "  LDL CHOLESTEROL (CALC) ....  95  mg/dL   REF <100",
  "",
  "COMMENT: FASTING SPECIMEN.",
  "-- END LIPID PROFILE --",
];

function edit(lines: readonly string[], i: number, value: string): string[] {
  const out = [...lines];
  out[i] = value;
  return out;
}

export const DEMO_REPORTS: readonly DemoReport[] = [
  {
    id: "cbc-clean",
    title: "CBC · clean",
    blurb: "A known layout. Every line explained. Accepted with zero AI calls.",
    layoutHint: "cbc",
    expect: "accepted",
    lines: CBC_CLEAN,
  },
  {
    id: "cbc-whisper",
    title: "CBC · a whisper on the hemoglobin line",
    blurb: "Someone appended text to a result line. A substring parser would still read 13.5.",
    layoutHint: "cbc",
    expect: "refusal",
    lines: edit(CBC_CLEAN, 8, CBC_CLEAN[8] + "  HIV REACTIVE"),
  },
  {
    id: "cbc-extra-line",
    title: "CBC · an extra result line",
    blurb: "A line the approved rule has never seen appears between results.",
    layoutHint: "cbc",
    expect: "refusal",
    lines: [...CBC_CLEAN.slice(0, 10), "HIV-1/2 AG/AB             REACTIVE", ...CBC_CLEAN.slice(10)],
  },
  {
    id: "cbc-unit",
    title: "CBC · unit changed",
    blurb: "Hemoglobin printed in g/L instead of g/dL. Same digits, ten times the meaning.",
    layoutHint: "cbc",
    expect: "refusal",
    lines: edit(CBC_CLEAN, 8, "HEMOGLOBIN (HGB)           135   g/L         12.0 - 17.5"),
  },
  {
    id: "cbc-truncated",
    title: "CBC · truncated",
    blurb: "The platelet line never arrived. Silence is not a result.",
    layoutHint: "cbc",
    expect: "refusal",
    lines: CBC_CLEAN.filter((_, i) => i !== 10),
  },
  {
    id: "cbc-implausible",
    title: "CBC · implausible value",
    blurb: "Hemoglobin 135.0 g/dL. Possibly a dropped decimal point. A human must decide.",
    layoutHint: "cbc",
    expect: "review",
    lines: edit(CBC_CLEAN, 8, "HEMOGLOBIN (HGB)         135.0   g/dL        12.0 - 17.5"),
  },
  {
    id: "bmp-clean",
    title: "BMP · clean",
    blurb: "A second approved layout, recognised and parsed deterministically.",
    layoutHint: "bmp",
    expect: "accepted",
    lines: BMP_CLEAN,
  },
  {
    id: "lipid-unknown",
    title: "Lipid profile · unknown layout",
    blurb: "A different vendor's format. No rule exists, so nothing is extracted. Onboard it.",
    layoutHint: "lipid",
    expect: "layout-mismatch",
    lines: LIPID_ONBOARD,
  },
  {
    id: "lipid-repeat",
    title: "Lipid profile · next patient",
    blurb: "After you approve the lipid rule: the next report, parsed with zero AI.",
    layoutHint: "lipid",
    expect: "accepted",
    lines: LIPID_REPEAT,
  },
];

export const LAYOUT_SAMPLES = {
  cbc: { layoutId: "cbc", layoutName: "Complete Blood Count (LABSYS/370 LAB-CBC-01)", lines: CBC_CLEAN },
  bmp: { layoutId: "bmp", layoutName: "Basic Metabolic Panel (LABSYS/370 LAB-BMP-02)", lines: BMP_CLEAN },
  lipid: { layoutId: "lipid", layoutName: "Lipid Profile (Outreach Lab)", lines: LIPID_ONBOARD },
} as const;
