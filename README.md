# llms-txt-rag-compare

A concrete PoC that shows **why `llms.txt` matters for RAG builders**.

Runs two pipelines against the same site and the same question, then compares results:

| | Mode A: Naive | Mode B: llms.txt |
|---|---|---|
| Discovery | Fetch sitemap → crawl all pages | Read `/llms.txt` → use curated list |
| Bonus | — | Try `/llms-full.txt` (single request, full content) |
| Benefit | Works everywhere | Faster, cleaner, owner-controlled |

## Demo site

[wiki.totto.org](https://wiki.totto.org) — has both `/llms.txt` and `/llms-full.txt`.

## Setup

```bash
npm install
cp .env.example .env
# add your ANTHROPIC_API_KEY to .env
```

## Run

```bash
# Full comparison (both modes, side-by-side summary)
node compare.js

# Naive only
node compare.js --mode naive

# llms.txt only
node compare.js --mode llmstxt

# Custom query
node compare.js --query "How does KCP handle versioning?"
```

## What you'll see

```
╔══════════════════════════════════════════════════════╗
║        llms-txt-rag-compare  (Cantara PoC)          ║
╚══════════════════════════════════════════════════════╝

Demo site: https://wiki.totto.org
Query:     "What is KCP and what problem does it solve?"

╔══════════════════════════════════════════════════════╗
║  MODE A: Naive Scraping (sitemap → crawl all)        ║
╚══════════════════════════════════════════════════════╝
  Sitemap has 87 URLs — capping at 30 for demo
  Crawling 30 pages ..............................
  Sending 72,000 chars to Claude ...

╔══════════════════════════════════════════════════════╗
║  MODE B: llms.txt-guided (curated index)             ║
╚══════════════════════════════════════════════════════╝
  ✓ Got llms.txt
  ✓ llms-full.txt found! — zero crawling needed
  Sending 45,000 chars to Claude ...

╔══════════════════════════════════════════════════════╗
║                  COMPARISON SUMMARY                  ║
╠══════════════════════════════════════════════════════╣
║  Pages processed:  30       vs 1 (llms.txt-guided)
║  Total time:       38.2s    vs 2.1s
║  llms.txt speedup: 18.2x faster
╠══════════════════════════════════════════════════════╣
║  llms.txt advantages:
║    ✓ No sitemap dependency or crawl logic needed
║    ✓ Site owner controls what gets indexed
║    ✓ llms-full.txt = single request, full context
║    ✓ Structured navigation hints for agents
║    ✓ Works even when Playwright / JS rendering fails
╚══════════════════════════════════════════════════════╝
```

## The point

RAG builders spend weeks building crawlers, DOM scrapers, hash-based change detection,
and vector pipelines. `llms.txt` lets the site owner do that work once — and every
RAG builder benefits immediately.

This is `robots.txt` for AI agents. The spec: [llmstxt.org](https://llmstxt.org)

## Related

- [KCP — Knowledge Context Protocol](https://wiki.totto.org/llms.txt)
- [llmstxt.org spec](https://llmstxt.org)
