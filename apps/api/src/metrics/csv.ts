import { parse } from "csv-parse/sync";
import { campaignRowSchema, type CampaignRow } from "@exhibit/contracts";

export interface CsvIssue {
  line: number;
  message: string;
}

export interface ParsedCampaigns {
  rows: CampaignRow[];
  issues: CsvIssue[];
}

const REQUIRED_COLUMNS = [
  "campaign_id",
  "campaign_name",
  "channel",
  "period",
  "start_date",
  "end_date",
  "currency",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "attribution_window",
];

/** Blank means missing (null). Anything non-blank must be a number, otherwise it is an issue. */
function numberOrNull(value: string | undefined): number | null | typeof Number.NaN {
  const text = (value ?? "").trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : Number.NaN;
}

/**
 * Parse a campaign CSV. Malformed rows are reported with their line number and skipped,
 * so the caller can show a readable message instead of silently dropping data.
 */
export function parseCampaignCsv(text: string, maxRows = 5000): ParsedCampaigns {
  const records: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: false,
  });

  const issues: CsvIssue[] = [];
  const first = records[0];
  if (first) {
    const missing = REQUIRED_COLUMNS.filter((column) => !(column in first));
    if (missing.length > 0) {
      return { rows: [], issues: [{ line: 1, message: `Missing columns: ${missing.join(", ")}.` }] };
    }
  }
  if (records.length > maxRows) {
    return { rows: [], issues: [{ line: 1, message: `File has ${records.length} rows; the limit is ${maxRows}.` }] };
  }

  const rows: CampaignRow[] = [];
  records.forEach((record, index) => {
    const line = index + 2;
    const candidate = {
      campaignId: record.campaign_id,
      campaignName: record.campaign_name,
      channel: record.channel,
      period: record.period,
      startDate: record.start_date,
      endDate: record.end_date,
      currency: record.currency,
      spend: numberOrNull(record.spend),
      impressions: numberOrNull(record.impressions),
      clicks: numberOrNull(record.clicks),
      conversions: numberOrNull(record.conversions),
      revenue: numberOrNull(record.revenue),
      attributionWindow: record.attribution_window,
      creativeRefId: record.creative_ref_id ? record.creative_ref_id : null,
    };
    const result = campaignRowSchema.safeParse(candidate);
    if (result.success) rows.push(result.data);
    else {
      const detail = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      issues.push({ line, message: detail });
    }
  });
  return { rows, issues };
}
