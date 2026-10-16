// Build-only stand-in for Google Fonts (unreachable from this workspace): answers every CSS request
// with a placeholder @font-face so `next build` can compile. Not a font-delivery check.
module.exports = new Proxy({}, {
  get: (_t, url) => typeof url !== "string" ? undefined : `/* mocked for ${url} */
@font-face { font-family: 'Mocked'; font-style: normal; font-weight: 100 900; font-display: swap;
  src: url(https://fonts.gstatic.com/s/mocked/v1/mocked-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF; }`,
});
