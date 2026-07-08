const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

class SourceModuleLoader {
  constructor(options = {}) {
    this.rootDirectory = path.resolve(options.rootDirectory || path.join(__dirname, "..", ".."));
    this.cache = new Map();
    this.context = vm.createContext({
      AbortController,
      ArrayBuffer,
      BigInt,
      Blob,
      Boolean,
      DataView,
      Error,
      File,
      Math,
      Map,
      Number,
      Object,
      Promise,
      RegExp,
      Set,
      String,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      URL,
      clearTimeout,
      console,
      fetch,
      setTimeout
    });
    this.linkPromises = new Map();
  }

  async import(relativePath) {
    const absolutePath = path.resolve(this.rootDirectory, relativePath);
    const module = await this.loadModule(absolutePath);
    return module.namespace;
  }

  async loadModule(absolutePath) {
    const sourceModule = await this.getOrCreateModule(absolutePath);
    await this.linkModule(sourceModule);
    if (sourceModule.status === "linked") await sourceModule.evaluate();
    return sourceModule;
  }

  async getOrCreateModule(absolutePath) {
    const normalizedPath = path.normalize(absolutePath);
    const cached = this.cache.get(normalizedPath);
    if (cached) return cached;

    const source = await fs.readFile(normalizedPath, "utf8");
    const sourceModule = new vm.SourceTextModule(source, {
      context: this.context,
      identifier: normalizedPath,
      initializeImportMeta(meta) {
        meta.url = pathToFileURL(normalizedPath).href;
      }
    });
    this.cache.set(normalizedPath, sourceModule);
    return sourceModule;
  }

  async linkModule(sourceModule) {
    if (sourceModule.status !== "unlinked") return;
    const existingPromise = this.linkPromises.get(sourceModule.identifier);
    if (existingPromise) {
      await existingPromise;
      return;
    }
    const linkPromise = sourceModule.link(async (specifier, referencingModule) => {
      if (!specifier.startsWith(".")) {
        throw new Error("Unsupported test import: " + specifier);
      }
      const resolvedPath = path.resolve(path.dirname(referencingModule.identifier), specifier);
      const dependencyModule = await this.getOrCreateModule(resolvedPath);
      if (dependencyModule.status === "unlinked") {
        await this.linkModule(dependencyModule);
      }
      return dependencyModule;
    });
    this.linkPromises.set(sourceModule.identifier, linkPromise);
    try {
      await linkPromise;
    } finally {
      this.linkPromises.delete(sourceModule.identifier);
    }
  }
}

async function createSourceModuleLoader() {
  return new SourceModuleLoader({ rootDirectory: path.join(__dirname, "..", "..") });
}

module.exports = {
  SourceModuleLoader,
  createSourceModuleLoader
};
