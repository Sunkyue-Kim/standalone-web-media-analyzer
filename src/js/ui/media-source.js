const MEDIA_PREVIEW_PRELOAD = "metadata";
const REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

function getMediaResourceKind(resource) {
  return resource && resource.kind === "remote-url" ? "remote-url" : "local-file";
}

function createMediaPreviewPlan(resource, options = {}) {
  const sourceKind = getMediaResourceKind(resource);
  const suppliedPreviewUrl = options.previewUrl || resource && resource.previewUrl || "";
  if (suppliedPreviewUrl) {
    return {
      sourceKind,
      url: suppliedPreviewUrl,
      isObjectUrl: false,
      preload: MEDIA_PREVIEW_PRELOAD,
      title: ""
    };
  }

  const objectUrlFactory = options.objectUrlFactory || getDefaultObjectUrlFactory();
  return {
    sourceKind,
    url: objectUrlFactory(resource),
    isObjectUrl: true,
    preload: MEDIA_PREVIEW_PRELOAD,
    title: ""
  };
}

function getDefaultObjectUrlFactory() {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return (resource) => URL.createObjectURL(resource);
  }
  throw new Error("Object URL creation is not available in this environment.");
}

function shouldDownloadRemoteOnceForSharedPlayback(resource, options = {}) {
  if (options.forceStreaming) return false;
  const size = Number(resource && resource.size || 0);
  return Number.isFinite(size) && size > 0 && size <= REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES;
}

export {
  MEDIA_PREVIEW_PRELOAD,
  REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES,
  createMediaPreviewPlan,
  getMediaResourceKind,
  shouldDownloadRemoteOnceForSharedPlayback
};
