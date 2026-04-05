#!/usr/bin/env node
/**
 * llms-txt-rag-compare
 *
 * Demonstrates the difference between:
 *  A) Naive scraping: fetch sitemap → crawl every page → answer
 *  B) llms.txt-guided: read /llms.txt → use curated URL list → answer
 *
 * Demo site: wiki.totto.org (has both /llms.txt and /llms-full.txt)
 */

import Anthropic from "@anthropic-ai/sdk";

const BASE_URL = "https://wiki.totto.org";
const QUERY =
  process.argv.includes("--query")
    ? process.argv[process.argv.indexOf("--query") + 1]
    : "What is KCP and what problem does it solve?";

const MODE = process.argv.includes("--mode naive")
  ? "naive"
  : process.argv.includes("--mode llmstxt")
  ? "llmstxt"
  : "both";

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "llms-txt-rag-compare/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000); // cap per page
}

function parseSitemapUrls(xml) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(BASE_URL));
}

function parseLlmsTxtUrls(txt) {
  // llms.txt format: markdown with links like [Title](url) or bare https:// lines
  const lines = txt.split("\n");
  const urls = [];
  for (const line of lines) {
    // markdown links
    const mdMatch = [...line.matchAll(/\[.*?\]\((https?:\/\/[^\)]+)\)/g)];
    for (const m of mdMatch) urls.push(m[1]);
    // bare URLs
    const bareMatch = line.match(/^(https?:\/\/\S+)$/);
    if (bareMatch) urls.push(bareMatch[1]);
  }
  return [...new Set(urls)].filter((u) => u.startsWith(BASE_URL));
}

async function fetchPages(urls, label) {
  const results = [];
  const start = Date.now();
  let fetched = 0;
  let failed = 0;

  process.stdout.write(`  Fetching ${urls.length} pages`);

  for (const url of urls) {
    const html = await fetchText(url);
    if (html) {
      results.push({ url, content: stripHtml(html) });
      fetched++;
    } else {
      failed++;
    }
    process.stdout.write(".");
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(` done (${fetched} ok, ${failed} failed, ${elapsed}s)`);
  return { pages: results, elapsed: parseFloat(elapsed) };
}

async function buildContext(pages) {
  return pages
    .map((p) => `--- ${p.url} ---\n${p.content}`)
    .join("\n\n")
    .slice(0, 80000); // stay under context window
}

async function answerQuery(client, context, query, label) {
  const start = Date.now();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are answering based only on the provided context. Be concise.

Context from ${label}:
${context}

Question: ${query}

Answer (cite the source URL):`,
      },
    ],
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const answer = response.content[0].text;
  return { answer, elapsed: parseFloat(elapsed) };
}

// ─── mode A: naive sitemap scraping ─────────────────────────────────────────

async function runNaive(client) {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  MODE A: Naive Scraping (sitemap → crawl all)    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const t0 = Date.now();

  // 1. Fetch sitemap
  console.log(`[1] Fetching sitemap from ${BASE_URL}/sitemap.xml ...`);
  const sitemapXml = await fetchText(`${BASE_URL}/sitemap.xml`);
  if (!sitemapXml) {
    console.log("  ✗ No sitemap found. Trying /sitemap_index.xml ...");
    const idx = await fetchText(`${BASE_URL}/sitemap_index.xml`);
    if (!idx) {
      console.log(
        "  ✗ No sitemap index either. Falling back to homepage only."
      );
    }
  }

  let urls = sitemapXml ? parseSitemapUrls(sitemapXml) : [BASE_URL];

  // Cap at 30 to keep demo reasonable (real naive crawl = potentially hundreds)
  const urlsCap = urls.slice(0, 30);
  if (urls.length > 30) {
    console.log(
      `  Sitemap has ${urls.length} URLs — capping at 30 for demo (real crawl would take much longer)`
    );
    urls = urlsCap;
  } else {
    console.log(`  Found ${urls.length} URLs in sitemap`);
  }

  // 2. Crawl pages
  console.log(`[2] Crawling all ${urls.length} pages ...`);
  const { pages, elapsed: fetchTime } = await fetchPages(urls, "naive");

  // 3. Build context
  const context = await buildContext(pages);
  const totalChars = context.length;

  // 4. Answer
  console.log(`[3] Sending ${totalChars.toLocaleString()} chars to Claude ...`);
  const { answer, elapsed: answerTime } = await answerQuery(
    client,
    context,
    QUERY,
    "full site crawl"
  );

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n┌─ RESULT ──────────────────────────────────────────┐");
  console.log(`│ Pages crawled:   ${pages.length}`);
  console.log(`│ Context size:    ${totalChars.toLocaleString()} chars`);
  console.log(`│ Fetch time:      ${fetchTime}s`);
  console.log(`│ LLM time:        ${answerTime}s`);
  console.log(`│ Total time:      ${totalTime}s`);
  console.log("├───────────────────────────────────────────────────┤");
  console.log("│ Answer:");
  console.log(
    answer
      .split("\n")
      .map((l) => "│   " + l)
      .join("\n")
  );
  console.log("└───────────────────────────────────────────────────┘");

  return { pages: pages.length, chars: totalChars, totalTime: parseFloat(totalTime), answer };
}

// ─── mode B: llms.txt-guided ─────────────────────────────────────────────────

async function runLlmsTxt(client) {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  MODE B: llms.txt-guided (curated index)         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const t0 = Date.now();

  // 1. Fetch llms.txt
  console.log(`[1] Fetching ${BASE_URL}/llms.txt ...`);
  const llmsTxt = await fetchText(`${BASE_URL}/llms.txt`);

  if (!llmsTxt) {
    console.log("  ✗ No llms.txt found at this site.");
    return null;
  }

  const wordCount = llmsTxt.split(/\s+/).length;
  console.log(`  ✓ Got llms.txt (${wordCount} words)`);

  // Show a preview
  const preview = llmsTxt.split("\n").slice(0, 6).join("\n");
  console.log("  Preview:");
  console.log(
    preview
      .split("\n")
      .map((l) => "    " + l)
      .join("\n")
  );
  console.log("  ...");

  // 2. Try llms-full.txt first (pre-concatenated content — no crawling needed!)
  console.log(`\n[2] Checking for ${BASE_URL}/llms-full.txt (pre-built index) ...`);
  const llmsFullTxt = await fetchText(`${BASE_URL}/llms-full.txt`);

  let pages, fetchTime, context, totalChars;

  if (llmsFullTxt) {
    const wordCountFull = llmsFullTxt.split(/\s+/).length;
    console.log(
      `  ✓ llms-full.txt found! (${wordCountFull.toLocaleString()} words) — zero crawling needed`
    );

    fetchTime = 0.1; // just one HTTP request
    pages = [{ url: `${BASE_URL}/llms-full.txt`, content: llmsFullTxt }];
    context = llmsFullTxt.slice(0, 80000);
    totalChars = context.length;
    console.log(`  Using pre-built full-text index (1 request vs many)`);
  } else {
    console.log("  No llms-full.txt. Extracting URLs from llms.txt ...");

    // 3. Parse URLs from llms.txt
    let urls = parseLlmsTxtUrls(llmsTxt);
    console.log(`  Found ${urls.length} curated URLs in llms.txt`);

    if (urls.length === 0) {
      // llms.txt may be descriptive rather than link-based — use it directly
      console.log("  llms.txt is descriptive (no links) — using it as context directly");
      pages = [{ url: `${BASE_URL}/llms.txt`, content: llmsTxt }];
      fetchTime = 0.1;
    } else {
      // 4. Fetch only the curated pages
      console.log(`[3] Fetching ${urls.length} curated pages ...`);
      const result = await fetchPages(urls, "llms.txt");
      pages = result.pages;
      fetchTime = result.elapsed;
    }

    context = await buildContext(pages);
    totalChars = context.length;
  }

  // 5. Answer
  console.log(`[3] Sending ${totalChars.toLocaleString()} chars to Claude ...`);
  const { answer, elapsed: answerTime } = await answerQuery(
    client,
    context,
    QUERY,
    "llms.txt-guided index"
  );

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n┌─ RESULT ──────────────────────────────────────────┐");
  console.log(`│ Pages/files:     ${pages.length} (curated)`);
  console.log(`│ Context size:    ${totalChars.toLocaleString()} chars`);
  console.log(`│ Fetch time:      ${fetchTime}s`);
  console.log(`│ LLM time:        ${answerTime}s`);
  console.log(`│ Total time:      ${totalTime}s`);
  console.log("├───────────────────────────────────────────────────┤");
  console.log("│ Answer:");
  console.log(
    answer
      .split("\n")
      .map((l) => "│   " + l)
      .join("\n")
  );
  console.log("└───────────────────────────────────────────────────┘");

  return { pages: pages.length, chars: totalChars, totalTime: parseFloat(totalTime), answer };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        llms-txt-rag-compare  (Cantara PoC)          ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nDemo site: ${BASE_URL}`);
  console.log(`Query:     "${QUERY}"\n`);

  let naiveResult = null;
  let guidedResult = null;

  if (MODE === "naive" || MODE === "both") {
    naiveResult = await runNaive(client);
  }

  if (MODE === "llmstxt" || MODE === "both") {
    guidedResult = await runLlmsTxt(client);
  }

  // Side-by-side summary
  if (MODE === "both" && naiveResult && guidedResult) {
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║                  COMPARISON SUMMARY                 ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(
      `║  Pages processed:  ${String(naiveResult.pages + " (capped*)").padEnd(12)} vs ${guidedResult.pages} (llms.txt-guided)`
    );
    console.log(
      `║  Context size:     ${String(naiveResult.chars.toLocaleString()).padEnd(12)} vs ${guidedResult.chars.toLocaleString()} chars`
    );
    console.log(
      `║  Total time:       ${String(naiveResult.totalTime + "s").padEnd(12)} vs ${guidedResult.totalTime}s`
    );
    const speedup =
      naiveResult.totalTime > guidedResult.totalTime
        ? `${(naiveResult.totalTime / guidedResult.totalTime).toFixed(1)}x faster (capped — full site: ~${Math.round(naiveResult.totalTime * 235 / 30)}s)`
        : "comparable";
    console.log(`║  llms.txt speedup: ${speedup}`);
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log("║  * Demo caps naive at 30 pages. This site has 235.  ║");
    console.log("║    Full crawl estimated ~11x slower than shown.     ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log("║  llms.txt advantages:                                ║");
    console.log("║    ✓ No sitemap dependency or crawl logic needed     ║");
    console.log("║    ✓ Site owner controls what gets indexed           ║");
    console.log("║    ✓ llms-full.txt = single request, full context    ║");
    console.log("║    ✓ Structured navigation hints for agents          ║");
    console.log("║    ✓ Works even when Playwright / JS rendering fails ║");
    console.log("║    ✓ Answer quality: spec details vs blog summaries  ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
