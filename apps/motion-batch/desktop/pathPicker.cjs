const VIDEO_FILTER = {
  name: "Video files",
  extensions: ["mov", "mp4", "m4v"]
};
const PICKER_ERROR_MESSAGE = "无法打开系统路径选择器。请手动复制路径后重试。";

function buildPathPickerDialogOptions(kind) {
  if (kind === "inputFile") {
    return {
      title: "选择输入视频",
      properties: ["openFile"],
      filters: [VIDEO_FILTER]
    };
  }

  if (kind === "inputFolder") {
    return {
      title: "选择输入文件夹",
      properties: ["openDirectory"]
    };
  }

  if (kind === "outputFolder") {
    return {
      title: "选择输出文件夹",
      properties: ["openDirectory", "createDirectory"]
    };
  }

  throw new Error(`Unknown path picker kind: ${kind}`);
}

function normalizePathPickerResult(result) {
  if (result?.canceled) return { canceled: true, path: "" };
  const selectedPath = result?.filePaths?.[0] ?? "";
  return {
    canceled: !selectedPath,
    path: selectedPath
  };
}

function normalizePathPickerError(error) {
  return {
    canceled: true,
    path: "",
    error: PICKER_ERROR_MESSAGE
  };
}

module.exports = {
  buildPathPickerDialogOptions,
  normalizePathPickerError,
  normalizePathPickerResult
};
