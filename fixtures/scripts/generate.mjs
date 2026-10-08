// Generates the synthetic campaign CSVs, creative reference CSVs, and the answer key.
// All data is fictional. Run with: node fixtures/scripts/generate.mjs
//
// Every campaign is defined by plain inputs (impressions, CTR, conversion rate, order value).
// Clicks, conversions, and revenue are derived deterministically, so the CSVs and the answer key
// always agree. The tests later recompute metrics from the CSVs with the real application code
// and compare against answer-key.json, which this script computes independently.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{id:string,name:string,channel:string,period:string,start:string,end:string,
 *   spend:number,impressions:number,ctr:number,cvr:number,aov:number,attribution:string,creative:string|null}} Campaign */

/** @type {Record<string, {name:string,currency:string,campaigns:Campaign[],creatives:object[]}>} */
const clients = {
  "ridgeline-outfitters": {
    name: "Ridgeline Outfitters",
    currency: "USD",
    campaigns: [
      c("RL-PIN-0801", "Trail Season Launch", "Pinterest", "2026-08", "2026-08-03", "2026-08-16", 11400, 1200000, 0.024, 0.02, 118, "7d_click", "RL-C01"),
      c("RL-PIN-0802", "Layering Basics", "Pinterest", "2026-08", "2026-08-17", "2026-08-30", 9800, 1050000, 0.011, 0.021, 96, "7d_click", "RL-C02"),
      c("RL-PIN-0901", "Summit Weekend", "Pinterest", "2026-09", "2026-09-07", "2026-09-21", 12600, 1300000, 0.026, 0.019, 124, "7d_click", "RL-C03"),
      c("RL-PIN-0902", "Fall Gear Guide", "Pinterest", "2026-09", "2026-09-14", "2026-09-28", 8700, 900000, 0.012, 0.022, 101, "7d_click", "RL-C04"),
      c("RL-MET-0801", "Basecamp Stories", "Meta", "2026-08", "2026-08-03", "2026-08-30", 14000, 2000000, 0.014, 0.016, 110, "7d_click", "RL-C05"),
      c("RL-MET-0901", "Ridge Run Film", "Meta", "2026-09", "2026-09-01", "2026-09-30", 15500, 2200000, 0.015, 0.015, 112, "7d_click", "RL-C06"),
      c("RL-GOO-0901", "Brand Search", "Google", "2026-09", "2026-09-01", "2026-09-30", 6200, 300000, 0.065, 0.038, 130, "7d_click", null),
    ],
    creatives: [
      cr("RL-C01", "RL-PIN-0801", "Alpine switchback hero", "Wide photograph of a hiker on an alpine switchback at golden hour, jacket in saturated orange against a grey ridge. Short overlay text lists three product features.", "bold-on-location", "product-features", "static"),
      cr("RL-C02", "RL-PIN-0802", "Layering flatlay", "Overhead flatlay of three base layers on a pale background, neutral colors, small caption naming each fabric.", "studio-flatlay", "product-features", "static"),
      cr("RL-C03", "RL-PIN-0901", "Summit weekend cover", "High-contrast photograph of two friends on a summit at sunrise, vivid jackets, large headline, one line of copy about fabric weight.", "bold-on-location", "product-features", "static"),
      cr("RL-C04", "RL-PIN-0902", "Fall gear grid", "Collage grid of eight product cutouts on a flat tan background with price labels.", "studio-flatlay", "product-features", "carousel"),
      cr("RL-C05", "RL-MET-0801", "Basecamp morning", "Short video of a camp stove and boots at dawn, ambient sound, a few seconds of product close-ups.", "bold-on-location", "product-features", "video"),
      cr("RL-C06", "RL-MET-0901", "Ridge run", "Thirty-second film of a trail runner crossing a ridge line; the product appears briefly at the end.", "bold-on-location", "product-features", "video"),
    ],
  },
  "marlowe-finch": {
    name: "Marlowe & Finch",
    currency: "USD",
    campaigns: [
      c("MF-PIN-0801", "Meet the Mill", "Pinterest", "2026-08", "2026-08-03", "2026-08-16", 2900, 420000, 0.013, 0.046, 88, "7d_click", "MF-C01"),
      c("MF-PIN-0802", "End of Summer Sale", "Pinterest", "2026-08", "2026-08-17", "2026-08-30", 2600, 380000, 0.016, 0.018, 72, "7d_click", "MF-C02"),
      c("MF-PIN-0901", "Worn For Years", "Pinterest", "2026-09", "2026-09-07", "2026-09-21", 3100, 450000, 0.012, 0.049, 92, "7d_click", "MF-C03"),
      c("MF-PIN-0902", "Fall Capsule", "Pinterest", "2026-09", "2026-09-14", "2026-09-28", 2800, 400000, 0.014, 0.023, 85, "7d_click", "MF-C04"),
      c("MF-MET-0801", "Letters From the Workshop", "Meta", "2026-08", "2026-08-03", "2026-08-30", 4200, 700000, 0.01, 0.039, 90, "7d_click_1d_view", "MF-C05"),
      c("MF-MET-0901", "Founder Letter", "Meta", "2026-09", "2026-09-01", "2026-09-30", 4500, 760000, 0.011, 0.044, 94, "7d_click_1d_view", "MF-C06"),
      c("MF-GOO-0901", "Brand Search", "Google", "2026-09", "2026-09-01", "2026-09-30", 2300, 120000, 0.052, 0.04, 95, "7d_click", null),
    ],
    creatives: [
      cr("MF-C01", "MF-PIN-0801", "Meet the mill", "Plain studio portrait of the mill owner holding a bolt of cloth, soft light, a three-sentence story about why the mill still weaves on old looms.", "studio-plain", "founder-letter", "static"),
      cr("MF-C02", "MF-PIN-0802", "Sale announcement grid", "Grid of six shirts on a white background with a bold 25 percent off banner.", "product-grid", "discount-announcement", "static"),
      cr("MF-C03", "MF-PIN-0901", "Worn for years", "Plain studio photo of a well-worn oxford shirt beside a customer's handwritten note describing ten years of wear.", "studio-plain", "customer-story", "static"),
      cr("MF-C04", "MF-PIN-0902", "Fall capsule", "Studio photo of five autumn pieces arranged on a stool with a short caption listing materials.", "studio-plain", "product-features", "static"),
      cr("MF-C05", "MF-MET-0801", "Letters from the workshop", "Carousel of workshop photos, each with a short caption from a different tailor describing one garment they made.", "studio-plain", "customer-story", "carousel"),
      cr("MF-C06", "MF-MET-0901", "Founder letter", "Single image of a typed letter from the founder to customers explaining how a shirt pattern was revised after feedback.", "studio-plain", "founder-letter", "static"),
    ],
  },
  "velvet-static": {
    name: "Velvet Static",
    currency: "USD",
    campaigns: [
      c("VS-MET-0801", "Drop 04 Countdown", "Meta", "2026-08", "2026-08-03", "2026-08-30", 21000, 900000, 0.031, 0.022, 140, "7d_click", "VS-C01"),
      c("VS-MET-0901", "Drop 05 Countdown", "Meta", "2026-09", "2026-09-01", "2026-09-30", 24000, 1000000, 0.034, 0.024, 150, "7d_click", "VS-C02"),
      c("VS-PIN-0901", "Lookbook Pins", "Pinterest", "2026-09", "2026-09-07", "2026-09-28", 3500, 500000, 0.014, 0.02, 130, "7d_click", "VS-C03"),
    ],
    creatives: [
      cr("VS-C01", "VS-MET-0801", "Drop 04 teaser", "Neon-lit night street scene, model in silhouette, countdown clock overlay and drop date.", "neon-high-contrast", "countdown-teaser", "video"),
      cr("VS-C02", "VS-MET-0901", "Drop 05 teaser", "Same neon night treatment with a rotating series of limited-run items revealed one by one.", "neon-high-contrast", "countdown-teaser", "video"),
      cr("VS-C03", "VS-PIN-0901", "Lookbook pins", "Daylight lookbook stills on a concrete wall, no overlay copy.", "studio-plain", "none", "static"),
    ],
  },
};

/** @returns {Campaign} */
function c(id, name, channel, period, start, end, spend, impressions, ctr, cvr, aov, attribution, creative) {
  return { id, name, channel, period, start, end, spend, impressions, ctr, cvr, aov, attribution, creative };
}

function cr(id, campaignId, title, description, visualStyle, storytelling, format) {
  return { id, campaignId, title, description, visualStyle, storytelling, format };
}

// ---- Derivation (the same arithmetic the application must reproduce) ----

function derive(campaign) {
  const clicks = Math.round(campaign.impressions * campaign.ctr);
  const conversions = Math.round(clicks * campaign.cvr);
  const revenue = Math.round(conversions * campaign.aov * 100) / 100;
  return { ...campaign, clicks, conversions, revenue };
}

const ratio = (n, d) => (d === 0 ? null : Math.round((n / d) * 1e6) / 1e6);

function metricsFor(rows) {
  const spend = sum(rows, "spend");
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const conversions = sum(rows, "conversions");
  const revenue = sum(rows, "revenue");
  return {
    spend,
    impressions,
    clicks,
    conversions,
    revenue,
    // Aggregate ratios come from totals, never from averaging campaign ratios.
    ctr: ratio(clicks, impressions),
    conversionRate: ratio(conversions, clicks),
    cpc: ratio(spend, clicks),
    costPerConversion: ratio(spend, conversions),
    roas: ratio(revenue, spend),
    cpm: impressions === 0 ? null : Math.round((spend / impressions) * 1000 * 1e6) / 1e6,
    // Normalized per 1,000 impressions: the form shared under performance-pattern approval.
    clicksPer1kImpressions: impressions === 0 ? null : Math.round((clicks / impressions) * 1000 * 1e6) / 1e6,
    conversionsPer1kImpressions: impressions === 0 ? null : Math.round((conversions / impressions) * 1000 * 1e6) / 1e6,
  };
}

function sum(rows, key) {
  return Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n";
}

function write(relative, content) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// ---- Output ----

const answerKey = { generatedBy: "fixtures/scripts/generate.mjs", note: "Synthetic data. Independent of application code.", clients: {} };

for (const [slug, client] of Object.entries(clients)) {
  const rows = client.campaigns.map(derive);

  write(
    `clients/${slug}/campaigns.csv`,
    toCsv(
      ["campaign_id", "campaign_name", "channel", "period", "start_date", "end_date", "currency", "spend", "impressions", "clicks", "conversions", "revenue", "attribution_window", "creative_ref_id"],
      rows.map((r) => [r.id, r.name, r.channel, r.period, r.start, r.end, client.currency, r.spend.toFixed(2), r.impressions, r.clicks, r.conversions, r.revenue.toFixed(2), r.attribution, r.creative]),
    ),
  );

  write(
    `clients/${slug}/creative_references.csv`,
    toCsv(
      ["creative_ref_id", "campaign_id", "title", "description", "visual_style", "storytelling_approach", "format", "asset_note"],
      client.creatives.map((x) => [x.id, x.campaignId, x.title, x.description, x.visualStyle, x.storytelling, x.format, "Text description only; no image file supplied."]),
    ),
  );

  const byCampaign = Object.fromEntries(rows.map((r) => [r.id, metricsFor([r])]));
  const channels = [...new Set(rows.map((r) => r.channel))];
  const periods = [...new Set(rows.map((r) => r.period))];
  const byChannelPeriod = {};
  for (const channel of channels) {
    for (const period of periods) {
      const subset = rows.filter((r) => r.channel === channel && r.period === period);
      if (subset.length) byChannelPeriod[`${channel}|${period}`] = metricsFor(subset);
    }
  }

  const styleOf = Object.fromEntries(client.creatives.map((x) => [x.campaignId, x]));
  const group = (field) => {
    const out = {};
    for (const value of new Set(client.creatives.map((x) => x[field]))) {
      const subset = rows.filter((r) => styleOf[r.id]?.[field] === value);
      out[value] = { campaignIds: subset.map((r) => r.id), ...metricsFor(subset) };
    }
    return out;
  };

  const pinterest = rows
    .filter((r) => r.channel === "Pinterest")
    .sort((a, b) => b.end.localeCompare(a.end));

  answerKey.clients[slug] = {
    name: client.name,
    currency: client.currency,
    byCampaign,
    byChannelPeriod,
    byVisualStyle: group("visualStyle"),
    byStorytelling: group("storytelling"),
    latestTwoPinterest:
      pinterest.length >= 2
        ? { campaignIds: pinterest.slice(0, 2).map((r) => r.id), note: "Ordered by end date, most recent first." }
        : null,
  };
}

write("evaluations/answer-key.json", JSON.stringify(answerKey, null, 2) + "\n");
console.log("Fixtures generated.");
