import { escapeHtml } from "./ui-helpers.js";

export function renderDataGridTable(options) {
  const columns = options.columns || [];
  const rows = options.rows || [];
  const className = options.className ? " " + options.className : "";
  const gridTemplateColumns = columns.map((column) => column.width || "minmax(0, 1fr)").join(" ");
  const minimumWidth = options.minimumWidth || "640px";
  const style = "--data-grid-columns:" + gridTemplateColumns + ";--data-grid-width:" + minimumWidth + ";";
  return '<div class="data-grid-shell' + escapeHtml(className) + '" style="' + escapeHtml(style) + '">' +
    '<div class="data-grid-scroll"><div class="data-grid-table">' +
    renderDataGridHeader(columns) +
    '<div class="data-grid-body">' + rows.map(renderDataGridRow).join("") + '</div>' +
    '</div></div></div>';
}

function renderDataGridHeader(columns) {
  return '<div class="data-grid-header">' + columns.map((column) => {
    return renderDataGridCell({
      value: column.label,
      className: column.className,
      title: column.title
    });
  }).join("") + '</div>';
}

function renderDataGridRow(row) {
  const className = row.className ? " " + row.className : "";
  return '<div class="data-grid-row' + escapeHtml(className) + '"' + renderDataGridAttributes(row.attributes) + '>' +
    (row.cells || []).map(renderDataGridCell).join("") +
    '</div>';
}

function renderDataGridCell(cell) {
  const normalizedCell = normalizeDataGridCell(cell);
  const className = normalizedCell.className ? ' class="' + escapeHtml(normalizedCell.className) + '"' : "";
  const title = normalizedCell.title ? ' title="' + escapeHtml(normalizedCell.title) + '"' : "";
  return '<div' + className + title + '>' + normalizedCell.html + '</div>';
}

function normalizeDataGridCell(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    return {
      html: cell.html === undefined ? escapeHtml(String(cell.value ?? "")) : String(cell.html),
      className: cell.className || "",
      title: cell.title || ""
    };
  }
  return {
    html: escapeHtml(String(cell ?? "")),
    className: "",
    title: ""
  };
}

function renderDataGridAttributes(attributes) {
  if (!attributes) return "";
  return Object.entries(attributes).map(([name, value]) => {
    if (value === false || value === null || value === undefined) return "";
    if (value === true) return " " + escapeHtml(name);
    return " " + escapeHtml(name) + '="' + escapeHtml(String(value)) + '"';
  }).join("");
}
