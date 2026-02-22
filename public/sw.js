if (!self.define) {
  let e,
    s = {};
  const a = (a, n) => (
    (a = new URL(a + '.js', n).href),
    s[a] ||
      new Promise((s) => {
        if ('document' in self) {
          const e = document.createElement('script');
          ((e.src = a), (e.onload = s), document.head.appendChild(e));
        } else ((e = a), importScripts(a), s());
      }).then(() => {
        let e = s[a];
        if (!e) throw new Error(`Module ${a} didn’t register its module`);
        return e;
      })
  );
  self.define = (n, c) => {
    const i =
      e ||
      ('document' in self ? document.currentScript.src : '') ||
      location.href;
    if (s[i]) return;
    let t = {};
    const r = (e) => a(e, i),
      o = { module: { uri: i }, exports: t, require: r };
    s[i] = Promise.all(n.map((e) => o[e] || r(e))).then((e) => (c(...e), t));
  };
}
define(['./workbox-e9849328'], function (e) {
  'use strict';
  (importScripts(),
    self.skipWaiting(),
    e.clientsClaim(),
    e.precacheAndRoute(
      [
        { url: '/VERSION.txt', revision: '48f16f5f67fb054902be16b484801d35' },
        {
          url: '/_next/app-build-manifest.json',
          revision: '0713622515fce8b7f89150829ae64fbb',
        },
        {
          url: '/_next/static/M_mVpfkxe2pzP2WLCFPV7/_buildManifest.js',
          revision: '046380ae5bc74b46b6d5eac3eed65355',
        },
        {
          url: '/_next/static/M_mVpfkxe2pzP2WLCFPV7/_ssgManifest.js',
          revision: 'b6652df95db52feb4daf4eca35380933',
        },
        {
          url: '/_next/static/chunks/160-ea11b416b8350561.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/29-147aefe3d1326a5c.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/359-dc4baa83b3ec761a.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/40-866a049899db07bc.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/438-641d0921c9df1189.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/46-fe587cc9c9ee9eb5.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/51b697cb-6aa6f0a91173421a.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/588-bc4554a004e29dd8.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/706-c2bf6b218a3d3cc5.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/853-8c14aca4231d8c2a.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/885-887f17ce8253f7e1.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/_not-found/page-49e110685307904d.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/admin/page-b991bb70cc2d4e0e.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/douban/page-cdb73f0a85684aad.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/layout-9104574222cbdd18.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/live/page-37413069beb304f0.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/login/page-6b745cdc4a7baf5a.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/page-c800d7a193568046.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/play/page-210cc30157aa4f68.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/register/page-3ac289d0ed76c527.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/search/page-93c31fb64e009ef8.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/app/warning/page-11cba4cf9332a238.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/deb030d4-1499a520a8cc5e59.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/framework-6e06c675866dc992.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/main-a0a9e8634f6c3cc9.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/main-app-3457ac0ea4e058d1.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/pages/_app-792b631a362c29e1.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/pages/_error-9fde6601392a2a99.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/chunks/polyfills-42372ed130431b0a.js',
          revision: '846118c33b2c0e922d7b3a7676f81f6f',
        },
        {
          url: '/_next/static/chunks/webpack-d57fb7d9127260e0.js',
          revision: 'M_mVpfkxe2pzP2WLCFPV7',
        },
        {
          url: '/_next/static/css/4b6ffbea51abf789.css',
          revision: '4b6ffbea51abf789',
        },
        {
          url: '/_next/static/css/7cca8e2c5137bd71.css',
          revision: '7cca8e2c5137bd71',
        },
        {
          url: '/_next/static/media/19cfc7226ec3afaa-s.woff2',
          revision: '9dda5cfc9a46f256d0e131bb535e46f8',
        },
        {
          url: '/_next/static/media/21350d82a1f187e9-s.woff2',
          revision: '4e2553027f1d60eff32898367dd4d541',
        },
        {
          url: '/_next/static/media/8e9860b6e62d6359-s.woff2',
          revision: '01ba6c2a184b8cba08b0d57167664d75',
        },
        {
          url: '/_next/static/media/ba9851c3c22cd980-s.woff2',
          revision: '9e494903d6b0ffec1a1e14d34427d44d',
        },
        {
          url: '/_next/static/media/c5fe6dc8356a8c31-s.woff2',
          revision: '027a89e9ab733a145db70f09b8a18b42',
        },
        {
          url: '/_next/static/media/df0a9ae256c0569c-s.woff2',
          revision: 'd54db44de5ccb18886ece2fda72bdfe0',
        },
        {
          url: '/_next/static/media/e4af272ccee01ff0-s.p.woff2',
          revision: '65850a373e258f1c897a2b3d75eb74de',
        },
        { url: '/favicon.ico', revision: 'c5de6e56c5664adda146825f75ea6ecf' },
        {
          url: '/icons/icon-192x192.png',
          revision: '4a56c090828a1ad254c903c7aec0389d',
        },
        {
          url: '/icons/icon-256x256.png',
          revision: 'f6409eb1a001f754121e3a8281c0319c',
        },
        {
          url: '/icons/icon-384x384.png',
          revision: 'f6efc3e357b9ffdf4e0d8c14b2ed0ac1',
        },
        {
          url: '/icons/icon-512x512.png',
          revision: '9c008cbbeb6a576fe07bb1284a83f4d2',
        },
        { url: '/logo.png', revision: '40de611b143c47c6291c7bdad2c959ca' },
        { url: '/manifest.json', revision: 'be2730c78cddaa5c54b355611464694a' },
        { url: '/robots.txt', revision: '0483b37fb6cf7455cefe516197e39241' },
        {
          url: '/screenshot1.png',
          revision: 'a441ba0dcc958339ff3a181fa8407353',
        },
        {
          url: '/screenshot2.png',
          revision: 'bfc965d7b65b271fc1661a4384dabc9e',
        },
        { url: '/wechat.jpg', revision: 'd0f601311802667cd6ca5a37dc69bfa7' },
      ],
      { ignoreURLParametersMatching: [] },
    ),
    e.cleanupOutdatedCaches(),
    e.registerRoute(
      '/',
      new e.NetworkFirst({
        cacheName: 'start-url',
        plugins: [
          {
            cacheWillUpdate: async ({
              request: e,
              response: s,
              event: a,
              state: n,
            }) =>
              s && 'opaqueredirect' === s.type
                ? new Response(s.body, {
                    status: 200,
                    statusText: 'OK',
                    headers: s.headers,
                  })
                : s,
          },
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
      new e.CacheFirst({
        cacheName: 'google-fonts-webfonts',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 31536e3 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
      new e.StaleWhileRevalidate({
        cacheName: 'google-fonts-stylesheets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-font-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-image-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\/_next\/image\?url=.+$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'next-image',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:mp3|wav|ogg)$/i,
      new e.CacheFirst({
        cacheName: 'static-audio-assets',
        plugins: [
          new e.RangeRequestsPlugin(),
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:mp4)$/i,
      new e.CacheFirst({
        cacheName: 'static-video-assets',
        plugins: [
          new e.RangeRequestsPlugin(),
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:js)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-js-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:css|less)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-style-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\/_next\/data\/.+\/.+\.json$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'next-data',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:json|xml|csv)$/i,
      new e.NetworkFirst({
        cacheName: 'static-data-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => {
        if (!(self.origin === e.origin)) return !1;
        const s = e.pathname;
        return !s.startsWith('/api/auth/') && !!s.startsWith('/api/');
      },
      new e.NetworkFirst({
        cacheName: 'apis',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => {
        if (!(self.origin === e.origin)) return !1;
        return !e.pathname.startsWith('/api/');
      },
      new e.NetworkFirst({
        cacheName: 'others',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => !(self.origin === e.origin),
      new e.NetworkFirst({
        cacheName: 'cross-origin',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 3600 }),
        ],
      }),
      'GET',
    ));
});
