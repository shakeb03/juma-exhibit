export interface BrandContext {
  brandVoice: string;
  audience: string;
  goals: string;
  constraints: string;
  standingInstructions: string;
}

const SECTION_FIELDS: Record<string, keyof BrandContext> = {
  "brand voice": "brandVoice",
  audience: "audience",
  goals: "goals",
  constraints: "constraints",
  "standing instructions": "standingInstructions",
};

/** Split a brand.md into its named sections. Unknown sections are ignored; missing ones are empty. */
export function parseBrandContext(markdown: string): BrandContext {
  const context: BrandContext = { brandVoice: "", audience: "", goals: "", constraints: "", standingInstructions: "" };
  let field: keyof BrandContext | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (field) context[field] = lines.join("\n").trim();
    lines = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      field = SECTION_FIELDS[heading[1]!.toLowerCase()] ?? null;
    } else if (field) {
      lines.push(line);
    }
  }
  flush();
  return context;
}
