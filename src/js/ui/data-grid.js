import { escapeHtml } from "./ui-helpers.js";

const DATA_GRID_ESTIMATED_CHARACTER_WIDTH = 7.4;
const DATA_GRID_CELL_HORIZONTAL_SPACE = 24;
const DATA_GRID_DEFAULT_MINIMUM_WIDTH = "640px";

export function renderDataGridTable(options) {
  const columns = options.columns || [];
  const rows = options.rows || [];
  const className = options.className ? " " + options.className : "";
  const columnLayout = createDataGridColumnLayout(columns, rows);
  const minimumWidth = normalizeDataGridMinimumWidth(options.minimumWidth, columnLayout.minimumWidthPixels);
  const style = "--data-grid-columns:" + columnLayout.gridTemplateColumns + ";--data-grid-width:" + minimumWidth + ";";
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

function createDataGridColumnLayout(columns, rows) {
  const columnWidths = columns.map((column, columnIndex) => {
    return normalizeDataGridColumnWidth(column, columnIndex, rows);
  });
  const minimumWidthPixels = columnWidths.reduce((sum, columnWidth) => sum + columnWidth.minimumWidthPixels, 0);
  return {
    gridTemplateColumns: columnWidths.map((columnWidth) => columnWidth.gridTemplateColumn).join(" "),
    minimumWidthPixels
  };
}

function normalizeDataGridColumnWidth(column, columnIndex, rows) {
  const parsedWidth = parseDataGridColumnWidth(column.width);
  const contentMinimumWidthPixels = estimateDataGridColumnMinimumWidth(column, columnIndex, rows);
  const minimumWidthPixels = Math.max(parsedWidth.minimumWidthPixels, contentMinimumWidthPixels);
  return {
    gridTemplateColumn: "minmax(" + minimumWidthPixels + "px, " + parsedWidth.maximumWidth + ")",
    minimumWidthPixels
  };
}

function parseDataGridColumnWidth(width) {
  if (!width) return { minimumWidthPixels: 0, maximumWidth: "1fr" };
  const normalizedWidth = String(width).trim();
  const minmaxMatch = normalizedWidth.match(/^minmax\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/);
  if (minmaxMatch) {
    return {
      minimumWidthPixels: parsePixelWidth(minmaxMatch[1]),
      maximumWidth: minmaxMatch[2].trim()
    };
  }
  if (/\bfr\b/.test(normalizedWidth)) return { minimumWidthPixels: 0, maximumWidth: normalizedWidth };
  const minimumWidthPixels = parsePixelWidth(normalizedWidth);
  return {
    minimumWidthPixels,
    maximumWidth: "1fr"
  };
}

function parsePixelWidth(width) {
  const normalizedWidth = String(width || "").trim();
  if (normalizedWidth === "0") return 0;
  const pixelMatch = normalizedWidth.match(/^(\d+(?:\.\d+)?)px$/);
  return pixelMatch ? Math.ceil(Number(pixelMatch[1])) : 0;
}

function normalizeDataGridMinimumWidth(optionMinimumWidth, contentMinimumWidthPixels) {
  const fallbackMinimumWidth = optionMinimumWidth || DATA_GRID_DEFAULT_MINIMUM_WIDTH;
  const optionMinimumWidthPixels = parsePixelWidth(fallbackMinimumWidth);
  if (optionMinimumWidthPixels) return Math.max(optionMinimumWidthPixels, contentMinimumWidthPixels) + "px";
  return "max(" + fallbackMinimumWidth + ", " + contentMinimumWidthPixels + "px)";
}

function estimateDataGridColumnMinimumWidth(column, columnIndex, rows) {
  const textValues = [column.label, column.title];
  for (const row of rows) {
    textValues.push(getDataGridCellText((row.cells || [])[columnIndex]));
  }
  const longestTextLength = textValues.reduce((longestLength, textValue) => {
    return Math.max(longestLength, String(textValue || "").length);
  }, 0);
  if (!longestTextLength) return 0;
  return Math.ceil(longestTextLength * DATA_GRID_ESTIMATED_CHARACTER_WIDTH + DATA_GRID_CELL_HORIZONTAL_SPACE);
}

function getDataGridCellText(cell) {
  const normalizedCell = normalizeDataGridCell(cell);
  if (normalizedCell.title) return normalizedCell.title;
  return decodeBasicHtmlEntities(stripHtmlTags(normalizedCell.html));
}

function stripHtmlTags(html) {
  return String(html || "").replace(/<[^>]*>/g, "");
}

function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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
