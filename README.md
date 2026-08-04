# mcp-seo-keywords-ads

SEO Keywords (Google Ads volume) MCP — exact Google Ads search volume via

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `seo_keyword_google_ads_volume` | Exact Google Ads search volume for `<keyword>` — Google's own monthly search-volume numbers (plus competition and CPC) from the Ads API, for up to 10 keywords. Use when you specifically need Google Ads figures; for general SEO volume + keyword difficulty, prefer seo_keyword_overview (cheaper). Example: seo_keyword_google_ads_volume({ keywords: ["running shoes"], location_code: 2840, _apiKey: "your-base64-key" }) |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "seo-keywords-ads": {
      "url": "https://gateway.pipeworx.io/seo-keywords-ads/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Seo Keywords Ads data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
