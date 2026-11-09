const { isWebUrl } = require("./policy.cjs");

// Actions target the clicked contents, including a split pane, peek, or quick window.
function pageContextMenu(contents, params, { openTab, copyText }) {
  const items = [];
  const group = (entries) => {
    if (items.length) items.push({ type: "separator" });
    items.push(...entries);
  };
  if (params.linkURL) {
    group([
      ...(isWebUrl(params.linkURL)
        ? [{ label: "Open Link in New Tab", click: () => openTab(params.linkURL) }]
        : []),
      { label: "Copy Link Address", click: () => copyText(params.linkURL) },
    ]);
  }
  if (params.mediaType === "image" && params.hasImageContents) {
    group([
      { label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) },
      { label: "Copy Image Address", click: () => copyText(params.srcURL) },
    ]);
  }
  const flags = params.editFlags;
  if (params.isEditable) {
    group([
      { label: "Undo", enabled: flags.canUndo, click: () => contents.undo() },
      { label: "Redo", enabled: flags.canRedo, click: () => contents.redo() },
      { type: "separator" },
      { label: "Cut", enabled: flags.canCut, click: () => contents.cut() },
      { label: "Copy", enabled: flags.canCopy, click: () => contents.copy() },
      { label: "Paste", enabled: flags.canPaste, click: () => contents.paste() },
      { label: "Select All", enabled: flags.canSelectAll, click: () => contents.selectAll() },
    ]);
  } else if (params.selectionText) {
    group([{ label: "Copy", enabled: flags.canCopy, click: () => contents.copy() }]);
  }
  if (
    !params.isEditable &&
    !params.selectionText &&
    !params.linkURL &&
    params.mediaType !== "image"
  ) {
    const history = contents.navigationHistory;
    group([
      { label: "Back", enabled: history.canGoBack(), click: () => history.goBack() },
      { label: "Forward", enabled: history.canGoForward(), click: () => history.goForward() },
      { label: "Reload", click: () => contents.reload() },
    ]);
  }
  group([{ label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) }]);
  return items;
}

module.exports = { pageContextMenu };
