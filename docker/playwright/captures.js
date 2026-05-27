/**
 * Headless-Chromium capture of the two design surfaces the user
 * wants to inspect side-by-side:
 *
 *   • login page   — auctions hub :3200/en/login (public)
 *   • exchange     — bet :3100/en (auth-gated)
 *
 * For each, we emit:
 *
 *   <name>.desktop.png   1920×1080 full-page screenshot
 *   <name>.mobile.png      390× 844 full-page screenshot (iPhone-like)
 *   <name>.html            full rendered DOM (post-hydration)
 *   <name>.css             concatenated CSS from every <link rel="stylesheet">
 *                          (so the design comparison tool sees real styles,
 *                          not Tailwind utility classes verbatim)
 *
 * Auth strategy: hit /api/auth/login on the auctions hub to acquire the
 * `kalki_token` HttpOnly cookie, then share it across both browser
 * contexts. Cookies on `localhost` are scoped to the hostname so the
 * same cookie works on both :3200 and :3100 — but inside the docker
 * network we use service names (auctions / bet), so we set the cookie
 * with `Domain: ""` (the default, which scopes to the request host).
 * Easiest: do one explicit login PER context to make sure the cookie
 * is bound to that specific origin.
 *
 * Runs inside the kalki-net bridge network so it resolves `auctions`
 * and `bet` via docker DNS. The host machine never sees these requests.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = "/out";

const LOGIN_API_AUCTIONS = "http://auctions:3200/api/auth/login";
const LOGIN_API_BET      = "http://bet:3100/api/auth/login";

const TARGETS = [
  {
    name: "login",
    url: "http://auctions:3200/en/login",
    needsAuth: false,
    description: "Auctions hub — login surface (public)",
  },
  {
    name: "exchange",
    url: "http://bet:3100/en",
    needsAuth: true,
    description: "Kalki Exchange — bet app home (auth-gated)",
  },
];

const DESKTOP_VP = { width: 1920, height: 1080 };
const MOBILE_VP  = { width: 390,  height: 844  };

async function ensureSession(context, loginUrl) {
  // Same demo-user the seed creates. user1 is a regular non-admin
  // account so the exchange renders the same view a typical signed-in
  // user would see (no admin badge, etc).
  const res = await context.request.post(loginUrl, {
    data: { email: "user1@kalki.local", password: "password12345" },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(
      `login ${loginUrl} → ${res.status()} ${await res.text().catch(() => "")}`,
    );
  }
}

async function collectCss(page) {
  // Pull the contents of every <link rel="stylesheet"> so the design
  // tool can see the actual CSS rules (Tailwind v4 emits a single
  // bundle in dev under /_next/static/css/...). Inline <style> tags
  // are already in the saved HTML.
  return await page.evaluate(async () => {
    const links = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    );
    const parts = [];
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href) continue;
      try {
        const u = new URL(href, location.href).toString();
        const r = await fetch(u, { credentials: "include" });
        if (r.ok) {
          const css = await r.text();
          parts.push(`/* ===== ${href} ===== */\n${css}`);
        } else {
          parts.push(`/* ===== ${href} → HTTP ${r.status} ===== */`);
        }
      } catch (err) {
        parts.push(`/* ===== ${href} → ${err.message} ===== */`);
      }
    }
    return parts.join("\n\n");
  });
}

async function captureOne(browser, target, viewport, label, sharedCookies) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: label === "mobile" ? 2 : 1,
    isMobile: label === "mobile",
    hasTouch: label === "mobile",
    // ignoreHTTPSErrors so a self-signed cert in the future doesn't
    // break the capture. No-op on plain http://.
    ignoreHTTPSErrors: true,
  });

  if (target.needsAuth) {
    // The cookie returned by the hub's /api/auth/login is bound to
    // `auctions:3200`. To make it visible on `bet:3100` we need to
    // log in against bet too — which uses NextAuth's own provider.
    // Simpler path: run a fresh login against the hub from THIS
    // context, then explicitly clone the kalki_token cookie onto
    // bet's host. Both services accept the same JWT (single source
    // of truth: backend's JWT_SECRET).
    await ensureSession(context, LOGIN_API_AUCTIONS);
    const cookies = await context.cookies();
    const kalki = cookies.find((c) => c.name === "kalki_token");
    if (kalki) {
      // Re-add it scoped to the bet origin too.
      await context.addCookies([
        {
          name: kalki.name,
          value: kalki.value,
          domain: "bet",
          path: "/",
          httpOnly: kalki.httpOnly,
          sameSite: kalki.sameSite,
          // Express the same expiry the hub used.
          expires: kalki.expires,
        },
      ]);
    }
  }

  const page = await context.newPage();
  console.log(`  → navigating ${target.url}  [${label} ${viewport.width}×${viewport.height}]`);
  // `networkidle` waits for no in-flight requests for 500ms — picks
  // up SWR's first fetch + the hub's animated chart kicking in. Big
  // safety timeout because dev-mode Next.js cold compiles take ~10s.
  await page.goto(target.url, { waitUntil: "networkidle", timeout: 90_000 });

  // Give one extra beat for animations / lazy SVGs to land. The hub
  // has a hero animation that paints over a second.
  await page.waitForTimeout(1200);

  const pngPath  = path.join(OUT, `${target.name}.${label}.png`);
  const htmlPath = path.join(OUT, `${target.name}.${label}.html`);
  const cssPath  = path.join(OUT, `${target.name}.${label}.css`);

  await page.screenshot({ path: pngPath, fullPage: true });
  fs.writeFileSync(htmlPath, await page.content(), "utf8");
  fs.writeFileSync(cssPath,  await collectCss(page), "utf8");

  console.log(`     ✓ ${path.basename(pngPath)}`);
  console.log(`     ✓ ${path.basename(htmlPath)}`);
  console.log(`     ✓ ${path.basename(cssPath)}`);

  await context.close();
}

(async () => {
  if (!fs.existsSync(OUT)) {
    throw new Error(`mount /out is missing — check the -v bind mount`);
  }
  console.log(`output dir: ${OUT}`);

  const browser = await chromium.launch({
    // No-sandbox is required because the container runs as root.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const target of TARGETS) {
      console.log(`\n[${target.name}] ${target.description}`);
      await captureOne(browser, target, DESKTOP_VP, "desktop");
      await captureOne(browser, target, MOBILE_VP,  "mobile");
    }
  } finally {
    await browser.close();
  }

  // Write a tiny manifest so the user knows what each file is
  // without opening them.
  const manifest = TARGETS.flatMap((t) =>
    ["desktop", "mobile"].flatMap((label) => [
      { file: `${t.name}.${label}.png`,  what: `${t.description} — ${label} viewport, full-page PNG` },
      { file: `${t.name}.${label}.html`, what: `${t.description} — ${label} viewport, full rendered HTML` },
      { file: `${t.name}.${label}.css`,  what: `${t.description} — ${label} viewport, bundled stylesheet content` },
    ]),
  );
  fs.writeFileSync(
    path.join(OUT, "MANIFEST.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2),
    "utf8",
  );
  console.log(`\nMANIFEST.json written. Done.`);
})().catch((err) => {
  console.error("CAPTURE FAILED:", err);
  process.exit(1);
});
