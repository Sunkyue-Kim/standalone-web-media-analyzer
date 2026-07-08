const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const esbuild = require("esbuild");
const { minify: minifyHtml } = require("html-minifier-terser");

const rootDirectory = path.resolve(__dirname, "..");
const sourceDirectory = path.join(rootDirectory, "src");
const outputHtmlPath = path.join(rootDirectory, "mp4-analyzer.html");
const outputPagesHtmlPath = path.join(rootDirectory, "index.html");
const outputChunkedDirectory = path.join(rootDirectory, "chunked");
const outputChunkedAssetsDirectory = path.join(outputChunkedDirectory, "assets");
const outputChunkedHtmlPath = path.join(outputChunkedDirectory, "index.html");

async function build() {
  const templateHtml = await fs.readFile(path.join(sourceDirectory, "index.html"), "utf8");
  const mode = process.argv[2] || "all";
  if (!new Set(["all", "single", "chunked"]).has(mode)) {
    throw new Error("Unsupported build mode: " + mode);
  }
  if (mode === "all" || mode === "single") await buildSingleFileOutputs(templateHtml);
  if (mode === "all" || mode === "chunked") await buildChunkedOutput(templateHtml);
}

async function buildSingleFileOutputs(templateHtml) {
  const normalCss = await buildCss({ minify: false });
  const normalWorkerJs = await buildWorkerJavaScript({ minify: false });
  const normalJs = await buildJavaScript({ minify: false, workerJs: normalWorkerJs });
  const minifiedCss = await buildCss({ minify: true });
  const minifiedWorkerJs = await buildWorkerJavaScript({ minify: true });
  const minifiedJs = await buildJavaScript({ minify: true, workerJs: minifiedWorkerJs });

  const normalHtml = inlineAssets({
    templateHtml,
    css: normalCss,
    js: normalJs
  });

  const minifiedHtml = await buildMinifiedSingleFileHtml({
    templateHtml,
    css: minifiedCss,
    js: minifiedJs
  });

  await fs.writeFile(outputHtmlPath, normalHtml, "utf8");
  await fs.writeFile(outputPagesHtmlPath, minifiedHtml, "utf8");

  await verifySingleFileHtml(outputHtmlPath, normalHtml);
  await verifySingleFileHtml(outputPagesHtmlPath, minifiedHtml);

  console.log(`Built single ${path.basename(outputHtmlPath)} (${normalHtml.length} bytes)`);
  console.log(`Built single ${path.basename(outputPagesHtmlPath)} (${minifiedHtml.length} bytes)`);
}

async function buildChunkedOutput(templateHtml) {
  await fs.rm(outputChunkedDirectory, { recursive: true, force: true });
  await fs.mkdir(outputChunkedAssetsDirectory, { recursive: true });

  const minifiedCss = await buildCss({ minify: true });
  const cssFileName = "styles-" + hashText(minifiedCss).slice(0, 8) + ".css";
  const cssOutputPath = path.join(outputChunkedAssetsDirectory, cssFileName);
  await fs.writeFile(cssOutputPath, minifiedCss + "\n", "utf8");

  const scriptResult = await esbuild.build({
    absWorkingDir: sourceDirectory,
    entryPoints: {
      app: "./app.js",
      "analyzer-worker": "./js/worker/analyzer-worker.js"
    },
    plugins: [localSourcePlugin()],
    bundle: true,
    splitting: true,
    write: true,
    outdir: outputChunkedAssetsDirectory,
    format: "esm",
    minify: true,
    target: ["chrome115", "edge115", "firefox115", "safari16"],
    outExtension: { ".js": ".mjs" },
    entryNames: "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    metafile: true
  });
  const appOutputPath = findMetafileEntry(scriptResult.metafile, "app.js");
  const workerOutputPath = findMetafileEntry(scriptResult.metafile, "js/worker/analyzer-worker.js");
  const appHref = toRootRelativeHref(appOutputPath);
  const workerHref = toRootRelativeHref(workerOutputPath);
  const cssHref = "chunked/assets/" + cssFileName;
  const chunkedHtmlBeforeHtmlPass = createChunkedHtml({
    templateHtml,
    cssHref,
    appHref,
    workerHref
  });
  const chunkedHtml = (await minifyHtml(chunkedHtmlBeforeHtmlPass, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    minifyCSS: false,
    minifyJS: true,
    removeAttributeQuotes: false,
    removeComments: true,
    removeOptionalTags: false
  })).trim() + "\n";
  await fs.writeFile(outputChunkedHtmlPath, chunkedHtml, "utf8");
  await verifyChunkedHtml({
    html: chunkedHtml,
    appOutputPath,
    workerOutputPath
  });
  console.log(`Built chunked ${path.relative(rootDirectory, outputChunkedHtmlPath)} (${chunkedHtml.length} bytes)`);
  console.log(`Built chunked assets (${Object.keys(scriptResult.metafile.outputs).length + 1} files)`);
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

async function buildJavaScript({ minify, workerJs }) {
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
  return createInlineWorkerSourceScript(workerJs) + "\n" + result.outputFiles[0].text.trim();
}

async function buildWorkerJavaScript({ minify }) {
  const entrySource = await fs.readFile(path.join(sourceDirectory, "js", "worker", "analyzer-worker.js"), "utf8");
  const result = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: path.join(sourceDirectory, "js", "worker"),
      sourcefile: "analyzer-worker.js",
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

function createInlineWorkerSourceScript(workerJs) {
  return `if (typeof window !== "undefined") window.MP4AnalyzerWorkerSource = ${JSON.stringify(workerJs)};`;
}

function createChunkedHtml({ templateHtml, cssHref, appHref, workerHref }) {
  const withBase = templateHtml.replace(/<head>/i, '<head>\n  <base href="../">');
  const withCss = withBase.replace(
    /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*>/i,
    `<link rel="stylesheet" href="${cssHref}">`
  );
  return withCss.replace(
    /<script\s+src="\.\/app\.js"><\/script>/i,
    `<script>window.MP4AnalyzerWorkerModuleUrl = ${JSON.stringify(workerHref)};</script>\n  <script type="module" src="${appHref}"></script>`
  );
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function findMetafileEntry(metafile, entryPointSuffix) {
  const normalizedSuffix = entryPointSuffix.replace(/\\/g, "/");
  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    const entryPoint = output.entryPoint ? output.entryPoint.replace(/\\/g, "/") : "";
    if (entryPoint.endsWith(normalizedSuffix)) return normalizeOutputPath(outputPath);
  }
  throw new Error("Could not find chunked output for " + entryPointSuffix);
}

function normalizeOutputPath(outputPath) {
  return path.isAbsolute(outputPath) ? outputPath : path.resolve(sourceDirectory, outputPath);
}

function toRootRelativeHref(outputPath) {
  return path.relative(rootDirectory, outputPath).split(path.sep).join("/");
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
  return replaceTemplateAssets({
    templateHtml,
    cssReplacement: `<style>\n${css}\n</style>`,
    scriptReplacement: `<script>\n${escapeInlineScript(js)}\n</script>`
  });
}

function escapeInlineScript(script) {
  return script
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "\\x3C!--");
}

async function buildMinifiedSingleFileHtml({ templateHtml, css, js }) {
  const stylePlaceholder = "MP4_ANALYZER_INLINE_STYLE_PLACEHOLDER";
  const scriptPlaceholder = "MP4_ANALYZER_INLINE_SCRIPT_PLACEHOLDER";
  const htmlWithPlaceholders = replaceTemplateAssets({
    templateHtml,
    cssReplacement: `<style>${stylePlaceholder}</style>`,
    scriptReplacement: `<script>${scriptPlaceholder}</script>`
  });
  const minifiedShell = await minifyHtml(htmlWithPlaceholders, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    minifyCSS: false,
    minifyJS: false,
    removeAttributeQuotes: false,
    removeComments: true,
    removeOptionalTags: false
  });
  return minifiedShell
    .replace(stylePlaceholder, css)
    .replace(scriptPlaceholder, "\n" + escapeInlineScript(js) + "\n")
    .trim() + "\n";
}

function replaceTemplateAssets({ templateHtml, cssReplacement, scriptReplacement }) {
  const withCss = templateHtml.replace(
    /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*>/i,
    cssReplacement
  );
  return withCss.replace(
    /<script\s+src="\.\/app\.js"><\/script>/i,
    scriptReplacement
  );
}

async function verifySingleFileHtml(filePath, html) {
  const script = extractSingleInlineScript(filePath, html);
  new Function(script);

  const previousWindow = global.window;
  const previousDocument = global.document;
  try {
    global.window = {};
    delete global.document;
    eval(script);
    const runtimeApi = await global.window.MP4AnalyzerLoadRuntime();
    const result = await runtimeApi.runSmokeTests();
    if (!result.passed) {
      throw new Error(`${filePath} parser self-tests failed.`);
    }
  } finally {
    global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
}

function extractSingleInlineScript(filePath, html) {
  const startMarker = "<script>";
  const endMarker = "</script>";
  const startIndex = html.indexOf(startMarker);
  const endIndex = html.lastIndexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error(`${filePath} has no inline script.`);
  return html.slice(startIndex + startMarker.length, endIndex);
}

async function verifyChunkedHtml({ html, appOutputPath, workerOutputPath }) {
  if (!/<script\s+type="module"\s+src=/.test(html)) throw new Error("chunked HTML must load app as a module script.");
  if (!/MP4AnalyzerWorkerModuleUrl/.test(html)) throw new Error("chunked HTML must expose the worker module URL.");
  await fs.access(workerOutputPath);

  const previousWindow = global.window;
  const previousDocument = global.document;
  try {
    global.window = {};
    delete global.document;
    await import(pathToFileURL(appOutputPath).href + "?verify=" + Date.now());
    const runtimeApi = await global.window.MP4AnalyzerLoadRuntime();
    const result = await runtimeApi.runSmokeTests();
    if (!result.passed) {
      throw new Error(`${outputChunkedHtmlPath} parser self-tests failed.`);
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
