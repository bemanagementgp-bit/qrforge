# QRForge – Free QR Code Generator with Logo

A pure static mini web app (no build step, no framework) that generates static QR codes entirely in the browser.

**Live URL:** https://__SITE_URL__/ (replace after first deploy)

## Features

Free:
- Content types: URL, plain text, Wi-Fi (WPA/WEP/open, hidden), email (mailto with subject/body), phone (tel:), SMS (SMSTO), vCard 3.0
- Foreground/background colors, transparent background, square / rounded / dots module styles
- Export size 200–1000 px, quiet-zone margin 0–8 modules, error correction L/M/Q/H
- Live canvas preview, PNG download, copy image to clipboard, copy encoded string
- Contrast / quiet-zone scan-ability hints, settings persisted in `localStorage`
- Dark/light theme, SEO content, FAQ with JSON-LD

Pro (`isPro()` gate, one-time lifetime license):
- Center logo overlay (error correction auto-bumped to H)
- SVG vector download
- High-res export up to 4000 px
- Batch generation from a list (one PNG per line)

The only external dependency is `qrcode-generator@1.4.4` from jsDelivr (QR matrix encoding). Rendering to canvas and SVG is done in `app.js`.

## Run locally

```bash
npx serve .
```

Then open the printed localhost URL. `cleanUrls` is handled by Vercel in production; locally `/privacy.html` and `/terms.html` work directly.

## Deploy

Deploy the folder as a static site on Vercel (`vercel.json` is included). After the first deploy, replace the placeholder domain everywhere:

```bash
sed -i 's/__SITE_URL__/your-domain.vercel.app/g' index.html privacy.html terms.html robots.txt sitemap.xml config.js
```

## Monetization setup

All switches live in `config.js`:

1. **AdSense** – create an AdSense account, add the site, then set `ADSENSE_CLIENT: "ca-pub-XXXXXXXXXXXXXXXX"`. The `.ad-slot` placeholders (`sidebar-1`, `sidebar-2`, `below-tool`) are filled automatically with responsive units. Optionally create named ad units and match their IDs to the `data-slot` values.
2. **Analytics** – set `GA_ID: "G-XXXXXXX"`. `track()` already sends `generate`, `type_change`, `download`, `copy`, `logo_add`, `batch`, `pro_click` and `begin_checkout` events.
3. **Pro checkout** – create a product on Lemon Squeezy, Gumroad or a Stripe Payment Link for the lifetime license and set `PRO_CHECKOUT_URL`. Set `PRO_PRICE` to the displayed price.
4. **License activation** – `monetize.js` currently accepts any key of 8+ characters (demo gate). Before going live, replace `activateLicense()` with real validation (e.g. the Lemon Squeezy license API) and send the key in the purchase email.
5. **Affiliates (optional)** – add links to `AFFILIATE_LINKS` (e.g. label printers, business-card services) and render them where relevant.

## Files

```
index.html   tool page + SEO content + Pro modal
styles.css   shared base design system + app styles
app.js       QR building, canvas/SVG rendering, gating, persistence
monetize.js  theme, toast, GA, AdSense, Pro/licensing helpers (shared)
config.js    site configuration
privacy.html / terms.html
robots.txt / sitemap.xml / vercel.json / favicon.svg
```
