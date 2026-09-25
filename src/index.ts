interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
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
// Bounds DataForSEO's variable live Google-Ads latency (measured ~45s). Fails
// with an actionable message before the caller's timeout rather than hanging.
const DFS_LIVE_TIMEOUT_MS = 55000;

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
  // DataForSEO's live Google-Ads search-volume endpoint queries Google Ads in
  // real time (~45s, variable). Bound it so a slow call returns an actionable
  // error instead of hanging past the caller's timeout — and point to the fast
  // Labs alternative (seo_keyword_overview) for a search-volume estimate.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DFS_LIVE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error(
        `upstream_throttled: DataForSEO ${tool}'s live Google-Ads endpoint didn't respond within ${DFS_LIVE_TIMEOUT_MS / 1000}s (it queries Google Ads in real time). Retry shortly, or use seo_keyword_overview for a fast search-volume estimate.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
// Wave-2 CostModel (§4). ⚠️ Google Ads search_volume is ~7× pricier and may
// scale PER-KEYWORD ($0.075 for 1 kw). Conservative floor at the 10-kw cap ≈
// 1125 credits, but MUST MEASURE at 10 keywords before PLATFORM_DATAFORSEO_AUTH
// goes live — if it scales per-keyword the real base is much higher (≈11250).
// Priced to the cap = never underwater. Only charged when our key backs the call.
export default { tools, callTool, cost: { base: 1350 }, provider: 'dataforseo' } satisfies McpToolExport;
