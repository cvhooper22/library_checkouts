# Bookstamp favicons: ink and cream, one color

- light/: ink #26221C mark, for light browser chrome. App icons sit on a cream tile.
- dark/: cream #EFE3C6 mark, for dark browser chrome. App icons sit on an ink tile.
- favicon-adaptive.svg: a single SVG that switches from ink to cream when the OS is in dark mode.
- Favicons (ico, svg, 16, 32) are straight; app icons (180, 192, 512) carry the −1.2° tilt.

## Head tags (swap automatically)
```html
<link rel="icon" href="/favicon-adaptive.svg" type="image/svg+xml">
<link rel="icon" href="/light/favicon.ico" sizes="32x32" media="(prefers-color-scheme: light)">
<link rel="icon" href="/dark/favicon.ico" sizes="32x32" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/light/apple-touch-icon.png">
```
