const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");
const { minify: minifyHtml } = require("html-minifier-terser");

const rootDirectory = path.resolve(__dirname, "..");
const sourceDirectory = path.join(rootDirectory, "src");
const outputHtmlPath = path.join(rootDirectory, "standalone-web-media-analyzer.html");
const outputMinifiedHtmlPath = path.join(rootDirectory, "standalone-web-media-analyzer.min.html");
const outputPagesHtmlPath = path.join(rootDirectory, "index.html");

async function build() {
  const templateHtml = await fs.readFile(path.join(sourceDirectory, "index.html"), "utf8");
  const normalCss = await buildCss({ minify: false });
  const normalJs = await buildJavaScript({ minify: false });
  const minifiedCss = await buildCss({ minify: true });
  const minifiedJs = await buildJavaScript({ minify: true });

  const normalHtml = inlineAssets({
    templateHtml,
    css: normalCss,
    js: normalJs
  });

  const minifiedHtmlBeforeHtmlPass = inlineAssets({
    templateHtml,
    css: minifiedCss,
    js: minifiedJs
  });

  const minifiedHtml = (await minifyHtml(minifiedHtmlBeforeHtmlPass, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    minifyCSS: false,
    minifyJS: false,
    removeAttributeQuotes: false,
    removeComments: true,
    removeOptionalTags: false
  })).trim() + "\n";

  await fs.writeFile(outputHtmlPath, normalHtml, "utf8");
  await fs.writeFile(outputMinifiedHtmlPath, minifiedHtml, "utf8");
  await fs.writeFile(outputPagesHtmlPath, minifiedHtml, "utf8");

  verifyHtml(outputHtmlPath, normalHtml);
  verifyHtml(outputMinifiedHtmlPath, minifiedHtml);
  verifyHtml(outputPagesHtmlPath, minifiedHtml);

  console.log(`Built ${path.basename(outputHtmlPath)} (${normalHtml.length} bytes)`);
  console.log(`Built ${path.basename(outputMinifiedHtmlPath)} (${minifiedHtml.length} bytes)`);
  console.log(`Built ${path.basename(outputPagesHtmlPath)} (${minifiedHtml.length} bytes)`);
}

async function buildCss({ minify }) {
  const source = await fs.readFile(path.join(sourceDirectory, "styles.css"), "utf8");
  const result = await esbuild.transform(source, {
    loader: "css",
    minify,
    target: ["chrome115", "edge115", "firefox115", "safari16"]
  });
  return result.code.trim();
}

async function buildJavaScript({ minify }) {
  const entrySource = await fs.readFile(path.join(sourceDirectory, "app.js"), "utf8");
  const result = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: sourceDirectory,
      sourcefile: "app.js",
      loader: "js"
    },
    plugins: [localSourcePlugin()],
    bundle: true,
    write: false,
    format: "iife",
    minify,
    target: ["chrome115", "edge115", "firefox115", "safari16"]
  });
  return result.outputFiles[0].text.trim();
}

function localSourcePlugin() {
  return {
    name: "local-source",
    setup(build) {
      build.onResolve({ filter: /^\./ }, (args) => {
        return {
          path: path.resolve(args.resolveDir || sourceDirectory, args.path),
          namespace: "local-source"
        };
      });

      build.onLoad({ filter: /.*/, namespace: "local-source" }, async (args) => {
        return {
          contents: await fs.readFile(args.path, "utf8"),
          loader: "js",
          resolveDir: path.dirname(args.path)
        };
      });
    }
  };
}

function inlineAssets({ templateHtml, css, js }) {
  const withCss = templateHtml.replace(
    /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*>/i,
    `<style>\n${css}\n</style>`
  );
  return withCss.replace(
    /<script\s+src="\.\/app\.js"><\/script>/i,
    `<script>\n${js}\n</script>`
  );
}

function verifyHtml(filePath, html) {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/i);
  if (!scriptMatch) throw new Error(`${filePath} has no inline script.`);
  const script = scriptMatch[1];
  new Function(script);

  const previousWindow = global.window;
  const previousDocument = global.document;
  try {
    global.window = {};
    delete global.document;
    eval(script);
    const result = global.window.MP4AnalyzerCore.runParserSelfTests();
    if (!result.passed) {
      throw new Error(`${filePath} parser self-tests failed.`);
    }
  } finally {
    global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
