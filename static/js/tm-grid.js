const TM_GRID_SPACING_M = 1000;
const TM_GRID_MAX_LINES_PER_AXIS = 120;
const TM_GRID_MAX_LABELS_PER_AXIS = 100;
const TM_GRID_LINE_STEP_M = 250;
const TM_GRID_DEFAULT_COLOR = '#3948d2';
const TM_GRID_DEFAULT_WEIGHT = 1;
const TM_GRID_DEFAULT_OPACITY = 0.55;
const TM_SELECT_FILL = '#ffb366';
const TM_SELECT_FILL_OPACITY = 0.42;
const TM_SELECT_STROKE = '#e67e22';
const TM_RANGE_SELECT_ENABLED = false; // PDF 範圍選取（暫時停用）
// const TM_EXPORT_RENDER_MAX_PX = 4096;
// const TM_EXPORT_JPEG_QUALITY = 0.95;

const WGS84 = 'EPSG:4326';

const TWD97_TM2 = {
    119: '+proj=tmerc +lat_0=0 +lon_0=119 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    121: '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    123: '+proj=tmerc +lat_0=0 +lon_0=123 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
};

const TWD67_TM2 = {
    119: '+proj=tmerc +lat_0=0 +lon_0=119 +k=0.9999 +x_0=250000 +y_0=0 +ellps=clrk66 +towgs84=-382.168,-57.501,-275.479,0,0,0,0 +units=m +no_defs',
    121: '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=clrk66 +towgs84=-382.168,-57.501,-275.479,0,0,0,0 +units=m +no_defs',
    123: '+proj=tmerc +lat_0=0 +lon_0=123 +k=0.9999 +x_0=250000 +y_0=0 +ellps=clrk66 +towgs84=-382.168,-57.501,-275.479,0,0,0,0 +units=m +no_defs',
};

const TM2_ZONE_LON_RANGES = {
    119: [117.0, 120.5],
    121: [119.5, 122.5],
    123: [121.5, 125.0],
};

function tmZonesInBounds(bounds) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    return [119, 121, 123].filter((zone) => {
        const [zoneWest, zoneEast] = TM2_ZONE_LON_RANGES[zone];
        return east >= zoneWest && west <= zoneEast;
    });
}

function zoneForLng(lng) {
    if (lng < 120) return 119;
    if (lng < 122) return 121;
    return 123;
}

function getTmDef(crs, zone) {
    const defs = crs === 'twd67' ? TWD67_TM2 : TWD97_TM2;
    return defs[zone];
}

function isValidLatLng(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180;
}

function tmToLatLng(tmDef, easting, northing) {
    try {
        const [lng, lat] = proj4(tmDef, WGS84, [easting, northing]);
        if (!isValidLatLng(lat, lng)) return null;
        return [lat, lng];
    } catch (_) {
        return null;
    }
}

function latLngToGridCell(latlng, tmDef) {
    try {
        const [e, n] = proj4(WGS84, tmDef, [latlng.lng, latlng.lat]);
        if (!Number.isFinite(e) || !Number.isFinite(n)) return null;
        return {
            e: Math.floor(e / TM_GRID_SPACING_M) * TM_GRID_SPACING_M,
            n: Math.floor(n / TM_GRID_SPACING_M) * TM_GRID_SPACING_M,
        };
    } catch (_) {
        return null;
    }
}

function gridCellToPolygon(tmDef, easting, northing) {
    const sw = tmToLatLng(tmDef, easting, northing);
    const se = tmToLatLng(tmDef, easting + TM_GRID_SPACING_M, northing);
    const ne = tmToLatLng(tmDef, easting + TM_GRID_SPACING_M, northing + TM_GRID_SPACING_M);
    const nw = tmToLatLng(tmDef, easting, northing + TM_GRID_SPACING_M);
    if (!sw || !se || !ne || !nw) return null;
    return [sw, se, ne, nw];
}

function getCellsInSelection(corner1, corner2) {
    if (!corner2) return [{ e: corner1.e, n: corner1.n }];
    const minE = Math.min(corner1.e, corner2.e);
    const maxE = Math.max(corner1.e, corner2.e);
    const minN = Math.min(corner1.n, corner2.n);
    const maxN = Math.max(corner1.n, corner2.n);
    const cells = [];
    for (let e = minE; e <= maxE; e += TM_GRID_SPACING_M) {
        for (let n = minN; n <= maxN; n += TM_GRID_SPACING_M) {
            cells.push({ e, n });
        }
    }
    return cells;
}

function boundsToTmExtent(tmDef, bounds) {
    const toTm = (lat, lng) => {
        try {
            const [e, n] = proj4(WGS84, tmDef, [lng, lat]);
            if (!Number.isFinite(e) || !Number.isFinite(n)) return null;
            return { e, n };
        } catch (_) {
            return null;
        }
    };

    const samples = [];
    const lats = [bounds.getSouth(), bounds.getNorth()];
    const lngs = [bounds.getWest(), bounds.getEast()];
    const center = bounds.getCenter();

    for (const lat of lats) {
        for (const lng of lngs) samples.push(toTm(lat, lng));
    }
    samples.push(toTm(center.lat, center.lng));
    samples.push(toTm(center.lat, bounds.getWest()));
    samples.push(toTm(center.lat, bounds.getEast()));
    samples.push(toTm(bounds.getSouth(), center.lng));
    samples.push(toTm(bounds.getNorth(), center.lng));

    const valid = samples.filter(Boolean);
    if (valid.length === 0) return null;

    return {
        minE: Math.min(...valid.map((p) => p.e)),
        maxE: Math.max(...valid.map((p) => p.e)),
        minN: Math.min(...valid.map((p) => p.n)),
        maxN: Math.max(...valid.map((p) => p.n)),
    };
}

function computeTmGridExtent(tmDef, bounds, { applyLineLimit = true } = {}) {
    const extent = boundsToTmExtent(tmDef, bounds);
    if (!extent) return null;

    const spacing = TM_GRID_SPACING_M;
    const minE = Math.floor(extent.minE / spacing) * spacing;
    const maxE = Math.ceil(extent.maxE / spacing) * spacing;
    const minN = Math.floor(extent.minN / spacing) * spacing;
    const maxN = Math.ceil(extent.maxN / spacing) * spacing;
    const eastCount = Math.round((maxE - minE) / spacing);
    const northCount = Math.round((maxN - minN) / spacing);
    if (applyLineLimit && (
        eastCount > TM_GRID_MAX_LINES_PER_AXIS
        || northCount > TM_GRID_MAX_LINES_PER_AXIS
    )) {
        return null;
    }

    return { minE, maxE, minN, maxN };
}

function subsampleAxisValues(min, max, spacing, maxCount) {
    const values = [];
    for (let v = min; v <= max; v += spacing) values.push(v);
    if (values.length <= maxCount) return values;

    const groupSize = Math.ceil(values.length / maxCount);
    const sampled = [];
    for (let i = 0; i < values.length; i += groupSize) sampled.push(values[i]);
    const last = values[values.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
}

function formatGridAxisLabel(valueMeters) {
    return Math.round(valueMeters / TM_GRID_SPACING_M).toLocaleString();
}

function buildTmGridLines(tmDef, bounds) {
    const grid = computeTmGridExtent(tmDef, bounds);
    if (!grid) return [];

    const { minE, maxE, minN, maxN } = grid;
    const spacing = TM_GRID_SPACING_M;
    const lines = [];
    const step = TM_GRID_LINE_STEP_M;

    for (let e = minE; e <= maxE; e += spacing) {
        const points = [];
        for (let n = minN; n <= maxN; n += step) {
            const latLng = tmToLatLng(tmDef, e, n);
            if (latLng) points.push(latLng);
        }
        if (points.length >= 2) lines.push(points);
    }

    for (let n = minN; n <= maxN; n += spacing) {
        const points = [];
        for (let e = minE; e <= maxE; e += step) {
            const latLng = tmToLatLng(tmDef, e, n);
            if (latLng) points.push(latLng);
        }
        if (points.length >= 2) lines.push(points);
    }

    return lines;
}

function renderScreenEdgeLabels(map, overlay, tmDef, bounds, color) {
    const grid = computeTmGridExtent(tmDef, bounds, { applyLineLimit: false });
    if (!grid || !overlay) return;

    const size = map.getSize();
    if (!size?.x || !size?.y) return;

    const { minE, maxE, minN, maxN } = grid;
    const spacing = TM_GRID_SPACING_M;
    const labelColor = color || TM_GRID_DEFAULT_COLOR;
    const yMargin = 28;
    const xMargin = 36;

    subsampleAxisValues(minN, maxN, spacing, TM_GRID_MAX_LABELS_PER_AXIS).forEach((n) => {
        let bestPt = null;
        for (let e = minE; e <= maxE; e += spacing) {
            const latLng = tmToLatLng(tmDef, e, n);
            if (!latLng) continue;
            const pt = map.latLngToContainerPoint(L.latLng(latLng[0], latLng[1]));
            if (pt.y < -yMargin || pt.y > size.y + yMargin) continue;
            if (!bestPt || pt.x < bestPt.x) bestPt = pt;
        }
        if (!bestPt) return;
        appendOverlayLabel(overlay, formatGridAxisLabel(n), 4, bestPt.y, 'northing', labelColor);
    });

    subsampleAxisValues(minE, maxE, spacing, TM_GRID_MAX_LABELS_PER_AXIS).forEach((e) => {
        let bestPt = null;
        for (let n = minN; n <= maxN; n += spacing) {
            const latLng = tmToLatLng(tmDef, e, n);
            if (!latLng) continue;
            const pt = map.latLngToContainerPoint(L.latLng(latLng[0], latLng[1]));
            if (pt.x < -xMargin || pt.x > size.x + xMargin) continue;
            if (!bestPt || pt.y < bestPt.y) bestPt = pt;
        }
        if (!bestPt) return;
        appendOverlayLabel(overlay, formatGridAxisLabel(e), bestPt.x, 4, 'easting', labelColor);
    });
}

function appendOverlayLabel(overlay, text, x, y, axis, color) {
    const el = document.createElement('div');
    el.className = `tm-grid-label tm-grid-label--overlay tm-grid-label--${axis}`;
    el.style.setProperty('--tm-label-color', color);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.textContent = text;
    overlay.appendChild(el);
}

function waitForMapSettle(map, timeoutMs = 1800) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            resolve();
        };
        map.once('moveend', finish);
        setTimeout(finish, timeoutMs);
    });
}

/*
function waitForTilesIdle(map, timeoutMs = 8000, idleMs = 450) {
    return new Promise((resolve) => {
        let idleTimer = null;
        let finished = false;
        const cleanup = () => {
            map.off('tileload', onActivity);
            map.off('tileerror', onActivity);
            map.off('load', onActivity);
            if (idleTimer) clearTimeout(idleTimer);
        };
        const finish = () => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        };
        const onActivity = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(finish, idleMs);
        };
        map.on('tileload', onActivity);
        map.on('tileerror', onActivity);
        map.on('load', onActivity);
        setTimeout(finish, timeoutMs);
        onActivity();
    });
}

function getExportMaxZoom(map) {
    let maxZoom = map.getMaxZoom();
    map.eachLayer((layer) => {
        if (!map.hasLayer(layer) || !layer.options) return;
        if (!Number.isFinite(layer.options.maxZoom)) return;
        if (layer._url || typeof layer.setUrl === 'function') {
            maxZoom = Math.min(maxZoom, layer.options.maxZoom);
        }
    });
    return maxZoom;
}

function computeExportRenderSize(map) {
    const size = map.getSize();
    if (!size?.x || !size?.y) {
        return { w: TM_EXPORT_RENDER_MAX_PX, h: TM_EXPORT_RENDER_MAX_PX };
    }
    const aspect = size.x / size.y;
    if (aspect >= 1) {
        return {
            w: TM_EXPORT_RENDER_MAX_PX,
            h: Math.max(1, Math.round(TM_EXPORT_RENDER_MAX_PX / aspect)),
        };
    }
    return {
        w: Math.max(1, Math.round(TM_EXPORT_RENDER_MAX_PX * aspect)),
        h: TM_EXPORT_RENDER_MAX_PX,
    };
}

function captureMapElStyle(mapEl) {
    return {
        position: mapEl.style.position,
        left: mapEl.style.left,
        top: mapEl.style.top,
        width: mapEl.style.width,
        height: mapEl.style.height,
        zIndex: mapEl.style.zIndex,
    };
}

function enterExportRenderMode(mapEl, width, height) {
    mapEl.style.position = 'fixed';
    mapEl.style.left = '0';
    mapEl.style.top = '0';
    mapEl.style.width = `${width}px`;
    mapEl.style.height = `${height}px`;
    mapEl.style.zIndex = '9998';
}

function restoreMapElStyle(mapEl, style) {
    mapEl.style.position = style.position;
    mapEl.style.left = style.left;
    mapEl.style.top = style.top;
    mapEl.style.width = style.width;
    mapEl.style.height = style.height;
    mapEl.style.zIndex = style.zIndex;
}

function createExportOverlay(message) {
    const overlay = document.createElement('div');
    overlay.className = 'hiking-export-overlay';
    overlay.textContent = message;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return overlay;
}

function removeExportOverlay(overlay) {
    overlay?.remove();
    document.body.style.overflow = '';
}
*/

function initTmGrid(map) {
    if (typeof proj4 === 'undefined') {
        console.warn('proj4 not loaded; TM grid disabled');
        return;
    }

    if (!map.getPane('tmGridPane')) {
        const pane = map.createPane('tmGridPane');
        pane.style.zIndex = 350;
        pane.style.pointerEvents = 'none';
    }
    if (TM_RANGE_SELECT_ENABLED && !map.getPane('tmSelectPane')) {
        const pane = map.createPane('tmSelectPane');
        pane.style.zIndex = 360;
        pane.style.pointerEvents = 'none';
    }

    const twd97Layer = L.layerGroup([], { pane: 'tmGridPane' });
    const twd67Layer = L.layerGroup([], { pane: 'tmGridPane' });
    const selectionLayer = TM_RANGE_SELECT_ENABLED
        ? L.layerGroup([], { pane: 'tmSelectPane' })
        : null;
    map.addLayer(twd97Layer);
    map.addLayer(twd67Layer);
    if (selectionLayer) map.addLayer(selectionLayer);

    let showTwd97 = false;
    let showTwd67 = false;
    let updateTimer = null;
    const gridStyle = {
        color: TM_GRID_DEFAULT_COLOR,
        weight: TM_GRID_DEFAULT_WEIGHT,
        opacity: TM_GRID_DEFAULT_OPACITY,
    };

    let selection = null;

    const twd97Toggle = document.getElementById('toggle-twd97-grid');
    const twd67Toggle = document.getElementById('toggle-twd67-grid');
    const colorInput = document.getElementById('tm-grid-color');
    const widthInput = document.getElementById('tm-grid-width');
    const widthValueEl = document.getElementById('tm-grid-width-value');
    const hintEl = document.getElementById('tm-grid-hint');
    const mapEl = map.getContainer();
    const labelOverlay = document.createElement('div');
    labelOverlay.className = 'tm-grid-label-overlay';
    labelOverlay.setAttribute('aria-hidden', 'true');
    mapEl.appendChild(labelOverlay);

    function clampGridWeight(value) {
        const weight = Number.parseFloat(value);
        if (!Number.isFinite(weight)) return TM_GRID_DEFAULT_WEIGHT;
        return Math.min(6, Math.max(1, Math.round(weight)));
    }

    function normalizeGridColor(value) {
        if (typeof value !== 'string') return TM_GRID_DEFAULT_COLOR;
        const color = value.trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(color) ? color : TM_GRID_DEFAULT_COLOR;
    }

    function getGridLineStyle() {
        return {
            color: gridStyle.color,
            weight: gridStyle.weight,
            opacity: gridStyle.opacity,
            interactive: false,
        };
    }

    function syncStyleFromInputs() {
        if (colorInput) gridStyle.color = normalizeGridColor(colorInput.value);
        if (widthInput) gridStyle.weight = clampGridWeight(widthInput.value);
        if (widthValueEl && widthInput) widthValueEl.textContent = String(gridStyle.weight);
    }

    if (TM_RANGE_SELECT_ENABLED) {
    const exportBtn = document.getElementById('tm-grid-export-pdf');
    const selectStatusEl = document.getElementById('tm-grid-select-status');
    const crsRadios = document.querySelectorAll('input[name="tm-select-crs"]');

    function getSelectCrs() {
        const checked = document.querySelector('input[name="tm-select-crs"]:checked');
        return checked?.value === 'twd67' ? 'twd67' : 'twd97';
    }

    function ensureGridVisibleForCrs(crs) {
        if (crs === 'twd97' && twd97Toggle && !twd97Toggle.checked) {
            twd97Toggle.checked = true;
            showTwd97 = true;
            scheduleUpdate();
        }
        if (crs === 'twd67' && twd67Toggle && !twd67Toggle.checked) {
            twd67Toggle.checked = true;
            showTwd67 = true;
            scheduleUpdate();
        }
    }

    function isSelectionComplete() {
        return Boolean(selection?.corner1 && selection?.corner2);
    }

    function clearSelection() {
        selection = null;
        selectionLayer.clearLayers();
        updateSelectUi();
    }

    function selectionCells() {
        if (!selection?.corner1) return [];
        return getCellsInSelection(selection.corner1, selection.corner2);
    }

    function getSelectionTmExtent() {
        if (!selection?.corner1) return null;
        const cells = selectionCells();
        return {
            minE: Math.min(...cells.map((c) => c.e)),
            maxE: Math.max(...cells.map((c) => c.e)) + TM_GRID_SPACING_M,
            minN: Math.min(...cells.map((c) => c.n)),
            maxN: Math.max(...cells.map((c) => c.n)) + TM_GRID_SPACING_M,
        };
    }

    /*
    function selectionTmRectLatLngs() {
        if (!isSelectionComplete()) return null;
        const tmDef = getTmDef(selection.crs, selection.zone);
        const extent = getSelectionTmExtent();
        if (!tmDef || !extent) return null;
        const { minE, maxE, minN, maxN } = extent;
        const sw = tmToLatLng(tmDef, minE, minN);
        const se = tmToLatLng(tmDef, maxE, minN);
        const ne = tmToLatLng(tmDef, maxE, maxN);
        const nw = tmToLatLng(tmDef, minE, maxN);
        if (!sw || !se || !ne || !nw) return null;
        return { sw, se, ne, nw };
    }

    function selectionTmRectBounds() {
        const corners = selectionTmRectLatLngs();
        if (!corners) return null;
        return L.latLngBounds([corners.sw, corners.se, corners.ne, corners.nw]);
    }

    function selectionScreenCropRect(scale = 1) {
        const corners = selectionTmRectLatLngs();
        if (!corners) return null;
        const points = [corners.sw, corners.se, corners.ne, corners.nw].map(
            ([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng))
        );
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        return {
            x: Math.floor(Math.min(...xs) * scale),
            y: Math.floor(Math.min(...ys) * scale),
            w: Math.ceil((Math.max(...xs) - Math.min(...xs)) * scale),
            h: Math.ceil((Math.max(...ys) - Math.min(...ys)) * scale),
        };
    }
    */

    function renderSelection() {
        selectionLayer.clearLayers();
        if (!selection?.corner1) return;

        const tmDef = getTmDef(selection.crs, selection.zone);
        if (!tmDef) return;

        selectionCells().forEach(({ e, n }) => {
            const polygon = gridCellToPolygon(tmDef, e, n);
            if (!polygon) return;
            L.polygon(polygon, {
                color: TM_SELECT_STROKE,
                weight: 1,
                opacity: 0.65,
                fillColor: TM_SELECT_FILL,
                fillOpacity: TM_SELECT_FILL_OPACITY,
                interactive: false,
                pane: 'tmSelectPane',
            }).addTo(selectionLayer);
        });
    }

    function formatSelectionMeta() {
        if (!isSelectionComplete()) return null;
        const extent = getSelectionTmExtent();
        if (!extent) return null;
        const cells = selectionCells();
        const { minE, maxE, minN, maxN } = extent;
        const cols = (maxE - minE) / TM_GRID_SPACING_M;
        const rows = (maxN - minN) / TM_GRID_SPACING_M;
        const crsLabel = selection.crs === 'twd67' ? 'TWD67' : 'TWD97';
        return {
            crsLabel,
            zone: selection.zone,
            minE,
            maxE,
            minN,
            maxN,
            cols,
            rows,
            lines: [
                `座標系統：${crsLabel} 二度分帶 ${selection.zone}°`,
                `東距：${minE.toLocaleString()} ~ ${maxE.toLocaleString()} m`,
                `北距：${minN.toLocaleString()} ~ ${maxN.toLocaleString()} m`,
                `格網範圍：${cols} × ${rows} km（共 ${cells.length} 格）`,
            ],
        };
    }

    function updateSelectUi() {
        // if (exportBtn) exportBtn.disabled = !isSelectionComplete();

        if (!selectStatusEl) return;
        if (!selection?.corner1) {
            selectStatusEl.textContent = '請在地圖上點選第一格';
            return;
        }
        if (!selection.corner2) {
            selectStatusEl.textContent = '請點選第二格以圈選矩形範圍';
            return;
        }
        const meta = formatSelectionMeta();
        selectStatusEl.textContent = `${meta.cols}×${meta.rows} km 已選取；再點一次地圖可清除`;
    }

    function onMapClickForSelection(e) {
        const crs = getSelectCrs();
        ensureGridVisibleForCrs(crs);

        if (isSelectionComplete()) {
            clearSelection();
            return;
        }

        const zone = zoneForLng(e.latlng.lng);
        const tmDef = getTmDef(crs, zone);
        if (!tmDef) return;

        const cell = latLngToGridCell(e.latlng, tmDef);
        if (!cell) return;

        if (!selection?.corner1) {
            selection = { crs, zone, corner1: cell, corner2: null };
        } else if (!selection.corner2) {
            if (selection.crs !== crs || selection.zone !== zone) {
                selection = { crs, zone, corner1: cell, corner2: null };
            } else {
                selection.corner2 = cell;
            }
        }

        renderSelection();
        updateSelectUi();
    }

    /*
    async function exportSelectionPdf() {
        if (!isSelectionComplete()) return;
        if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
            window.alert('PDF 匯出元件尚未載入，請重新整理頁面後再試。');
            return;
        }

        const bounds = selectionTmRectBounds();
        const meta = formatSelectionMeta();
        if (!bounds || !meta) return;

        const prevCenter = map.getCenter();
        const prevZoom = map.getZoom();
        const selectPane = map.getPane('tmSelectPane');
        const prevSelectOpacity = selectPane?.style.opacity ?? '';
        const prevMapStyle = captureMapElStyle(mapEl);
        const exportMaxZoom = getExportMaxZoom(map);
        let exportOverlay = null;
        exportBtn.disabled = true;
        exportBtn.textContent = '匯出中…';

        try {
            exportOverlay = createExportOverlay('正在產生高畫質 PDF…');
            if (selectPane) selectPane.style.opacity = '0';

            const renderSize = computeExportRenderSize(map);
            enterExportRenderMode(mapEl, renderSize.w, renderSize.h);
            map.invalidateSize();

            map.fitBounds(bounds, { padding: [0, 0], maxZoom: exportMaxZoom, animate: false });
            updateGrids();
            map.invalidateSize();
            await waitForMapSettle(map, 3000);
            await waitForTilesIdle(map);

            const scale = Math.max(1, window.devicePixelRatio || 1);
            const canvas = await html2canvas(mapEl, {
                useCORS: true,
                allowTaint: true,
                logging: false,
                backgroundColor: '#ffffff',
                scale,
            });

            const crop = selectionScreenCropRect(scale);
            if (!crop || crop.w < 1 || crop.h < 1) {
                throw new Error('無法計算選取範圍的匯出區域');
            }

            const cropX = Math.max(0, Math.min(crop.x, canvas.width - 1));
            const cropY = Math.max(0, Math.min(crop.y, canvas.height - 1));
            const cropW = Math.min(crop.w, canvas.width - cropX);
            const cropH = Math.min(crop.h, canvas.height - cropY);

            if (cropW < 1 || cropH < 1) {
                throw new Error('無法計算選取範圍的匯出區域');
            }

            const cropped = document.createElement('canvas');
            cropped.width = cropW;
            cropped.height = cropH;
            cropped.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            const { jsPDF } = jspdf;
            const pdf = new jsPDF({
                orientation: cropW >= cropH ? 'landscape' : 'portrait',
                unit: 'px',
                format: [cropW, cropH],
            });
            pdf.addImage(
                cropped.toDataURL('image/jpeg', TM_EXPORT_JPEG_QUALITY),
                'JPEG',
                0,
                0,
                cropW,
                cropH
            );

            const stamp = new Date().toISOString().slice(0, 10);
            pdf.save(`grid-${meta.crsLabel.toLowerCase()}-${meta.zone}-${stamp}.pdf`);
        } catch (err) {
            console.error(err);
            window.alert(`PDF 匯出失敗：${err.message}`);
        } finally {
            removeExportOverlay(exportOverlay);
            restoreMapElStyle(mapEl, prevMapStyle);
            map.invalidateSize();
            if (selectPane) selectPane.style.opacity = prevSelectOpacity;
            map.setView(prevCenter, prevZoom, { animate: false });
            updateGrids();
            exportBtn.textContent = '匯出 PDF';
            updateSelectUi();
        }
    }
    */

    function onCrsChange() {
        clearSelection();
        mapEl.classList.add('hiking-map-select-mode');
        updateSelectUi();
    }
    }

    function setHint() {
        if (hintEl) hintEl.hidden = true;
        if (TM_RANGE_SELECT_ENABLED) updateSelectUi();
    }

    function fillLayer(layerGroup, zoneDefs, bounds, style) {
        layerGroup.clearLayers();
        const zones = tmZonesInBounds(bounds);
        zones.forEach((zone) => {
            const tmDef = zoneDefs[zone];
            if (!tmDef) return;
            const lines = buildTmGridLines(tmDef, bounds);
            lines.forEach((latlngs) => {
                L.polyline(latlngs, { ...style, pane: 'tmGridPane' }).addTo(layerGroup);
            });
        });
    }

    function updateGridLabelsNow() {
        labelOverlay.innerHTML = '';
        if (!showTwd97 && !showTwd67) {
            labelOverlay.hidden = true;
            return;
        }
        labelOverlay.hidden = false;
        const bounds = map.getBounds();
        const style = getGridLineStyle();
        if (showTwd97) {
            tmZonesInBounds(bounds).forEach((zone) => {
                const tmDef = TWD97_TM2[zone];
                if (tmDef) renderScreenEdgeLabels(map, labelOverlay, tmDef, bounds, style.color);
            });
        }
        if (showTwd67) {
            tmZonesInBounds(bounds).forEach((zone) => {
                const tmDef = TWD67_TM2[zone];
                if (tmDef) renderScreenEdgeLabels(map, labelOverlay, tmDef, bounds, style.color);
            });
        }
    }

    function updateGrids() {
        setHint();
        updateGridLabelsNow();

        const bounds = map.getBounds().pad(0.05);

        if (showTwd97) {
            fillLayer(twd97Layer, TWD97_TM2, bounds, getGridLineStyle());
        } else {
            twd97Layer.clearLayers();
        }

        if (showTwd67) {
            fillLayer(twd67Layer, TWD67_TM2, bounds, getGridLineStyle());
        } else {
            twd67Layer.clearLayers();
        }
    }

    function scheduleUpdate() {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(updateGrids, 120);
    }

    function onToggle97() {
        showTwd97 = twd97Toggle?.checked ?? false;
        updateGridLabelsNow();
        scheduleUpdate();
    }

    function onToggle67() {
        showTwd67 = twd67Toggle?.checked ?? false;
        updateGridLabelsNow();
        scheduleUpdate();
    }

    twd97Toggle?.addEventListener('change', onToggle97);
    twd67Toggle?.addEventListener('change', onToggle67);
    colorInput?.addEventListener('input', () => {
        syncStyleFromInputs();
        updateGridLabelsNow();
        scheduleUpdate();
    });
    widthInput?.addEventListener('input', () => {
        syncStyleFromInputs();
        scheduleUpdate();
    });
    if (TM_RANGE_SELECT_ENABLED) {
    crsRadios.forEach((radio) => radio.addEventListener('change', onCrsChange));
    // exportBtn?.addEventListener('click', exportSelectionPdf);
    map.on('click', onMapClickForSelection);
    mapEl.classList.add('hiking-map-select-mode');
    updateSelectUi();
    }
    map.on('moveend zoomend', scheduleUpdate);
    map.on('move zoom', updateGridLabelsNow);
    map.on('resize', updateGridLabelsNow);

    syncStyleFromInputs();
    updateGridLabelsNow();

    return TM_RANGE_SELECT_ENABLED
        ? { updateGrids, scheduleUpdate, clearSelection }
        : { updateGrids, scheduleUpdate };
}
