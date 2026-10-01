import { build } from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/app.js",
  // File-type icons (src/icons/svg/*.svg) are referenced from styles.css via
  // plain url("icons/svg/....svg"). Without this, esbuild's CSS bundler
  // treats every url() as an asset it must load+hash+copy itself, which
  // fails outright ("No loader is configured for .svg files") unless one is
  // registered -- marking svg external instead leaves the path exactly as
  // written, so it resolves the same way the favicon links in index.html
  // already do: relative to dist/app.css, against the icons/ folder the
  // cpSync below copies wholesale. This also means a newly dropped-in icon
  // never needs a build.mjs change, just a CSS rule.
  external: ["*.svg"],
  logLevel: "info",
});

copyFileSync("src/index.html", "dist/index.html");
cpSync("src/icons", "dist/icons", { recursive: true });

// config.js is meant to be hand-edited directly in dist/ (paths for the office
// machine, not the dev machine) -- never overwrite an existing one, only seed
// the template on the very first build.
if (!existsSync("dist/config.js")) {
  copyFileSync("src/config.js", "dist/config.js");
} else {
  console.log("dist/config.js already exists -- left it alone (edit it directly to change paths).");
}

console.log("Build complete -> dist/");
