import { parse } from "csv-parse/sync";

export interface CreativeReferenceRow {
  refId: string;
  campaignId: string | null;
  title: string;
  description: string;
  visualStyle: string;
  storytellingApproach: string;
  format: string;
  assetNote: string;
}

const REQUIRED = ["creative_ref_id", "title", "description", "visual_style", "storytelling_approach", "format", "asset_note"];

/** Parse creative_references.csv. Throws a readable error for missing columns or blank required cells. */
export function parseCreativeReferencesCsv(text: string): CreativeReferenceRow[] {
  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const first = records[0];
  if (first) {
    const missing = REQUIRED.filter((column) => !(column in first));
    if (missing.length > 0) throw new Error(`Creative references file is missing columns: ${missing.join(", ")}.`);
  }
  return records.map((record, index) => {
    for (const column of REQUIRED) {
      if (!record[column]) throw new Error(`Creative references line ${index + 2}: ${column} is blank.`);
    }
    return {
      refId: record.creative_ref_id!,
      campaignId: record.campaign_id ? record.campaign_id : null,
      title: record.title!,
      description: record.description!,
      visualStyle: record.visual_style!,
      storytellingApproach: record.storytelling_approach!,
      format: record.format!,
      assetNote: record.asset_note!,
    };
  });
}
