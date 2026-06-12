const BRIDGE_CLOSE_ERROR_DIALOG = Object.freeze({
  title: "任务恢复记录保存失败",
  message: "当前任务已停止，但任务恢复记录可能没有完全保存。请重新打开应用确认任务状态；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。"
});

const STARTUP_ERROR_DIALOG = Object.freeze({
  title: "启动失败",
  message: "openFAD Motion Batch 启动失败。请确认应用完整安装，并重新打开应用；如果仍失败，请把控制台诊断发给 openFAD 社区 issue。"
});

function buildBridgeCloseErrorDialog() {
  return { ...BRIDGE_CLOSE_ERROR_DIALOG };
}

function buildStartupErrorDialog() {
  return { ...STARTUP_ERROR_DIALOG };
}

module.exports = {
  buildBridgeCloseErrorDialog,
  buildStartupErrorDialog
};
