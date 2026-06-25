interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * SEO Keywords (Google Ads volume) MCP — exact Google Ads search volume via
 * DataForSEO (dataforseo.com).
 *
 * Tools:
 * - seo_keyword_google_ads_volume: Google's own Ads search volume for keywords.
 *
 * SEPARATE pack from seo-keywords on purpose: this endpoint is ~7x pricier
 * ($0.075 vs $0.0101/call), and pack-level metering is homogeneous — keeping it
 * isolated lets seo-keywords stay cheap and lets Wave 2 price this pack to its
 * own (higher) worst case. Reserve for "exact Google Ads numbers" asks; for
 * general volume + difficulty use seo-keywords (seo_keyword_overview), cheaper.
 *
 * Auth: DataForSEO HTTP Basic. Pass _apiKey = base64("login:password").
 * Wave 1 = BYO-key only. Wave 2 adds a measured `cost` CostModel + realCogs flag.
 */


const BASE_URL = 'https://api.dataforseo.com';

const tools: McpToolExport['tools'] = [
  {
    name: 'seo_keyword_google_ads_volume',
    description:
      "Exact Google Ads search volume for `<keyword>` — Google's own monthly search-volume numbers (plus competition and CPC) from the Ads API, for up to 10 keywords. Use when you specifically need Google Ads figures; for general SEO volume + keyword difficulty, prefer seo_keyword_overview (cheaper). Example: seo_keyword_google_ads_volume({ keywords: [\"running shoes\"], location_code: 2840, _apiKey: \"your-base64-key\" })",
    inputSchema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to look up (max 10), e.g. ["running shoes", "trail shoes"]',
        },
        location_code: {
          type: 'integer',
          description: 'DataForSEO location code (default 2840 = United States)',
        },
        language_code: {
          type: 'string',
          description: 'Two-letter language code (default "en")',
        },
        _apiKey: {
          type: 'string',
          description: 'DataForSEO API key = base64("login:password") from your dataforseo.com account',
        },
      },
      required: ['keywords', '_apiKey'],
    },
  },
];

async function dfsPost(path: string, body: unknown, apiKey: string, tool: string) {
  if (!apiKey) {
    throw new Error(
      `${tool} requires a DataForSEO API key. Pass _apiKey = base64("login:password") from your DataForSEO account (sign up at dataforseo.com). This is a paid data source — bring your own key, or add credits at https://pipeworx.io/account.`,
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `DataForSEO auth failed (HTTP ${res.status}). Check _apiKey is base64("login:password") and your account is funded/verified (data endpoints return 40104 until the account is funded). Re-encode credentials and retry.`,
    );
  }
  if (!res.ok) throw new Error(`DataForSEO ${tool} error: HTTP ${res.status}`);
  const data = (await res.json()) as DfsResponse;
  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO ${tool}: ${data.status_code} ${data.status_message}`);
  }
  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(`DataForSEO ${tool}: ${task?.status_code ?? 'no task'} ${task?.status_message ?? ''}`.trim());
  }
  return task;
}

interface DfsResponse {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    cost: number;
    result?: Array<Record<string, unknown>> | null;
  }>;
}

async function googleAdsVolume(args: Record<string, unknown>, apiKey: string) {
  const keywords = args.keywords as string[];
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('seo_keyword_google_ads_volume requires a non-empty `keywords` array, e.g. ["running shoes"].');
  }
  if (keywords.length > 10) {
    throw new Error(`seo_keyword_google_ads_volume accepts at most 10 keywords per call (got ${keywords.length}). Split into batches.`);
  }
  const location_code = (args.location_code as number) ?? 2840;
  const language_code = (args.language_code as string) ?? 'en';

  const task = await dfsPost(
    '/v3/keywords_data/google_ads/search_volume/live',
    [{ keywords, location_code, language_code }],
    apiKey,
    'seo_keyword_google_ads_volume',
  );

  // google_ads/search_volume returns one result row per keyword (not nested under items).
  const rows = (task.result ?? []) as Array<Record<string, unknown>>;
  const keywordsOut = rows.map((r) => ({
    keyword: r.keyword as string,
    search_volume: (r.search_volume as number) ?? null,
    competition: (r.competition as string) ?? null,
    cpc: (r.cpc as number) ?? null,
  }));

  return { location_code, language_code, keywords: keywordsOut };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string;
  delete args._apiKey;

  switch (name) {
    case 'seo_keyword_google_ads_volume':
      return googleAdsVolume(args, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Wave 1 (BYO-only): nominal access meter; user's own key bears DataForSEO COGS.
// Wave 2: measured `cost` CostModel — ~7x seo-keywords, price to its own worst
// case (10 keywords) + realCogs gate. Kept in its own pack for that reason.
export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
