export function calculateRecyclerWindow(options) {
  const rowCount = Math.max(0, Math.floor(Number(options.rowCount) || 0));
  const rowHeight = Math.max(1, Number(options.rowHeight) || 1);
  const scrollTop = Math.max(0, Number(options.scrollTop) || 0);
  const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
  const overscan = Math.max(0, Math.floor(Number(options.overscan) || 0));
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return {
    first,
    last,
    count: Math.max(0, last - first),
    totalHeight: Math.max(1, rowCount * rowHeight)
  };
}

export function createRecyclerView(options) {
  const state = {
    rows: [],
    renderRequest: 0
  };
  const rowHeight = Math.max(1, Number(options.rowHeight) || 1);
  const overscan = Math.max(0, Math.floor(Number(options.overscan) || 0));
  const scrollTopOffset = Math.max(0, Number(options.scrollTopOffset) || 0);
  const viewportHeightOffset = Math.max(0, Number(options.viewportHeightOffset) || 0);

  function setRows(rows) {
    state.rows = Array.isArray(rows) ? rows : [];
    options.spacerElement.style.height = Math.max(1, state.rows.length * rowHeight) + "px";
  }

  function scheduleRender() {
    cancelRender();
    state.renderRequest = requestAnimationFrame(() => {
      state.renderRequest = 0;
      renderNow();
    });
  }

  function cancelRender() {
    if (!state.renderRequest) return;
    cancelAnimationFrame(state.renderRequest);
    state.renderRequest = 0;
  }

  function renderNow() {
    cancelRender();
    const range = getVisibleRange();
    const html = [];
    for (let rowIndex = range.first; rowIndex < range.last; rowIndex += 1) {
      html.push(options.renderRow(state.rows[rowIndex], rowIndex));
    }
    options.spacerElement.innerHTML = html.join("");
    return range;
  }

  function getVisibleRange() {
    return calculateRecyclerWindow({
      rowCount: state.rows.length,
      rowHeight,
      scrollTop: Math.max(0, (Number(options.scrollElement.scrollTop) || 0) - scrollTopOffset),
      viewportHeight: Math.max(1, (Number(options.scrollElement.clientHeight) || 400) - viewportHeightOffset),
      overscan
    });
  }

  function scrollRowIntoCenter(rowIndex) {
    const normalizedRowIndex = Math.max(0, Math.min(state.rows.length - 1, Math.floor(Number(rowIndex) || 0)));
    if (!state.rows.length || normalizedRowIndex < 0) return;
    const clientHeight = Number(options.scrollElement.clientHeight) || 400;
    const contentHeight = scrollTopOffset + state.rows.length * rowHeight;
    const scrollHeight = Number(options.scrollElement.scrollHeight);
    const maxScrollTop = Math.max(0, (Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : contentHeight) - clientHeight);
    const rowCenter = scrollTopOffset + normalizedRowIndex * rowHeight + rowHeight / 2;
    options.scrollElement.scrollTop = clamp(rowCenter - clientHeight / 2, 0, maxScrollTop);
  }

  return {
    setRows,
    scheduleRender,
    renderNow,
    getVisibleRange,
    scrollRowIntoCenter
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
