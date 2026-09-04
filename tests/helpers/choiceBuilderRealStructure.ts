import type { ExtractedPdfPage } from "@/domain/pdfExtraction";

/**
 * Sanitized copy of the REAL Choice Builder extractor output.
 * Header wording, Policy Number formatting, continuation rows, wrapped
 * company-name fragments, parenthetical adjustments, repeated page headers,
 * and footer/totals match the production extractPdfPages() lines. Customer
 * names, policy numbers, and amounts are fictional.
 */
export const choiceBuilderRealStructurePages: ExtractedPdfPage[] = [
  {
    pageNumber: 1,
    text: "",
    lines: [
      "COMMISSION STATEMENT",
      "Choice Builder",
      "555-010-0000",
      "Vendor #:    VEN-10000001",
      "Check #:    100001",
      "EXAMPLE INSURANCE BROKERS",
      "Statement Date:    August 24, 2026",
      "100 MAIN STREET STE 100",
      "EXAMPLE, CA 90000",
      "Paid commissions reflect premium payments received prior to August 24, 2026.",
      "An accrued balance of $25.00 is required for release of payment.",
      "COMMISSIONS FOR AGENCY EXAMPLE INSURANCE",
      "BROKERS",
      "Broker Name    Comm",
      "Amount",
      "ALEX MORGAN    $340.68",
      "TOTAL PAID COMMISSIONS    $340.68",
      "COMMISSIONS FOR BROKER ALEX MORGAN",
      "Company Name    Paid Month    Product    Comm Amount    ADJ CD",
      "Policy Number: B10001",
      "ACME PET RESORT    Aug 2026    Dental    $14.88",
      "Aug 2026    Vision    $7.47",
      "Sep 2026    Dental    $14.88",
      "Sep 2026    Vision    $7.47",
      "Policy Number: B10002",
      "NORTHSIDE INSURANCE AGENCY INC    Sep 2026    Dental    $21.28",
      "Sep 2026    Vision    $2.95",
      "Policy Number: B10003",
      "RIVER REALTY    Sep 2026    Dental    $18.32",
      "Sep 2026    Vision    $1.07",
      "Policy Number: B10004",
      "SUMMIT HEATING AND COOLING    Sep 2026    Dental    $3.69",
      "Page 1 of 3",
    ],
  },
  {
    pageNumber: 2,
    text: "",
    lines: [
      "Company Name    Paid Month    Product    Comm Amount    ADJ CD",
      "Sep 2026    Vision    $1.07",
      "Policy Number: B10005",
      "H & R CONTRACTING INC    Jul 2026    Dental    $3.75",
      "Aug 2026    Dental    $1.59",
      "Aug 2026    Vision    ($0.89)",
      "Sep 2026    Dental    $46.59",
      "Sep 2026    Vision    $13.98",
      "Policy Number: B10006",
      "VALLEY HEATING AND COOLING    Sep 2026    Dental    $39.32",
      "Sep 2026    Life    $1.65",
      "Sep 2026    Vision    $8.25",
      "Policy Number: B10007",
      "LAKESIDE INSURANCE    Sep 2026    Dental    $9.76",
      "AGENCY",
      "Sep 2026    Vision    $1.86",
      "Policy Number: B10008",
      "PINE DISTRICT CHURCH OF    Sep 2026    Dental    $23.64",
      "NAZARENE",
      "Sep 2026    Vision    $2.79",
      "Policy Number: B10009",
      "WILLOW CREEK LAND AND CATTLE    Sep 2026    Dental    $18.09",
      "LLC",
      "Sep 2026    Vision    $3.13",
      "Policy Number: B10010",
      "RALLY POINT    Sep 2026    Dental    $27.48",
      "Sep 2026    Vision    $6.86",
      "TOTAL COMMISSIONS: ALEX MORGAN",
      "Total Dental Commissions    $277.74",
      "Total Vision Commissions    $58.68",
      "Total Life Commissions    $3.09",
      "Total Chiropractic Commissions    $1.17",
      "Page 2 of 3",
    ],
  },
  {
    pageNumber: 3,
    text: "",
    lines: [
      "Company Name    Paid Month    Product    Comm Amount    ADJ CD",
      "TOTAL PAID COMMISSIONS    $340.68",
      "Page 3 of 3",
    ],
  },
];

choiceBuilderRealStructurePages.forEach((page) => {
  page.text = page.lines.join("\n");
});
