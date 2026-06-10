const DEFAULT_TRACK_COLOR = '#e74c3c';

const tracksManifestUrl = 'contents/hiking/tracks.yml';
const SIDEBAR_WIDTH_KEY = 'hiking-sidebar-width';
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 320;

let trackSearchQuery = '';
let showWaypointIcons = true;
const trackLayers = new Map();

const map = L.map('map', {
    center: [23.7, 121.0],
    zoom: 8,
    minZoom: 7,
    maxZoom: 18,
});

const baseLayers = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        subdomains: ['a', 'b', 'c'],
    }),
    // 國土測繪中心 1/25,000 經建版（WMTS 座標順序為 z/y/x）
    jingjian: L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/B25000/default/GoogleMapsCompatible/{z}/{y}/{x}.png',
        {
            attribution: '&copy; <a href="https://www.nlsc.gov.tw/">國土測繪中心</a> 經建版地形圖',
            maxZoom: 16,
            minZoom: 7,
        }
    ),
    // tile.happyman.idv.tw（rs.happyman.idv.tw 已無法連線）
    rudy: L.tileLayer('https://tile.happyman.idv.tw/map/moi_osm/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://rudy.mobi/">魯地圖</a> Taiwan TOPO',
        maxZoom: 18,
        minZoom: 7,
    }),
};

let activeBaseLayer = baseLayers.rudy;
activeBaseLayer.addTo(map);

function setBaseLayer(key) {
    if (!baseLayers[key] || activeBaseLayer === baseLayers[key]) return;

    map.removeLayer(activeBaseLayer);
    activeBaseLayer = baseLayers[key];
    activeBaseLayer.addTo(map);

    trackLayers.forEach(({ layer, visible }) => {
        if (visible) layer.bringToFront();
    });

    map.invalidateSize();
}

document.getElementById('map-type-select').addEventListener('change', (e) => {
    setBaseLayer(e.target.value);
});

function normalizeHexColor(color, fallback = DEFAULT_TRACK_COLOR) {
    if (typeof color !== 'string') return fallback;
    const value = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        const [, r, g, b] = value;
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return fallback;
}

function findKmlInZip(zip) {
    const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
    if (!kmlFile) throw new Error('KMZ 檔案中找不到 KML');
    return kmlFile;
}

async function extractKmzAssets(zip) {
    const assetUrls = {};
    const imageExt = /\.(jpe?g|png|gif|webp)$/i;

    await Promise.all(Object.entries(zip.files).map(async ([path, file]) => {
        if (file.dir || !imageExt.test(path)) return;
        const normalized = path.replace(/\\/g, '/');
        const blob = await file.async('blob');
        const url = URL.createObjectURL(blob);
        assetUrls[normalized] = url;
        assetUrls[normalized.toLowerCase()] = url;
        const base = normalized.split('/').pop();
        if (base) assetUrls[base] = url;
    }));

    return assetUrls;
}

function trackAssetBaseUrl(trackPath) {
    if (!trackPath || trackPath.startsWith('blob:')) return '';
    const normalized = trackPath.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    return slash >= 0 ? normalized.slice(0, slash + 1) : '';
}

async function extractKmlBundle(source, trackPath = '') {
    if (source instanceof File) {
        const name = source.name.toLowerCase();
        if (name.endsWith('.kml')) {
            return { kmlText: await source.text(), assetUrls: {}, assetBaseUrl: '' };
        }
        if (name.endsWith('.kmz')) {
            const zip = await JSZip.loadAsync(source);
            const kmlFile = findKmlInZip(zip);
            const [kmlText, assetUrls] = await Promise.all([
                zip.file(kmlFile).async('text'),
                extractKmzAssets(zip),
            ]);
            return { kmlText, assetUrls, assetBaseUrl: '' };
        }
        throw new Error('不支援的檔案格式');
    }

    const path = trackPath || (typeof source === 'string' ? source : '');
    const assetBaseUrl = trackAssetBaseUrl(path);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`無法載入：${source}`);

    const url = path.toLowerCase();
    if (url.endsWith('.kml')) {
        return { kmlText: await response.text(), assetUrls: {}, assetBaseUrl };
    }

    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const kmlFile = findKmlInZip(zip);
    const [kmlText, assetUrls] = await Promise.all([
        zip.file(kmlFile).async('text'),
        extractKmzAssets(zip),
    ]);
    return { kmlText, assetUrls, assetBaseUrl: '' };
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getDescriptionHtml(desc) {
    if (!desc) return '';
    if (typeof desc === 'object' && desc.value) return desc.value;
    return String(desc);
}

function resolveAssetUrl(src, assetUrls, assetBaseUrl = '') {
    const normalized = src.replace(/^\.\//, '').replace(/\\/g, '/');
    if (assetUrls[normalized]) return assetUrls[normalized];
    if (assetUrls[normalized.toLowerCase()]) return assetUrls[normalized.toLowerCase()];
    const base = normalized.split('/').pop();
    if (base && assetUrls[base]) return assetUrls[base];

    if (assetBaseUrl && !/^(https?:|data:|blob:)/i.test(src)) {
        const rel = normalized.replace(/^files\//, '');
        return assetBaseUrl + rel;
    }
    return src;
}

function resolveDescriptionHtml(desc, assetUrls, assetBaseUrl = '') {
    const html = getDescriptionHtml(desc);
    if (!html) return '';

    return html.replace(/src=["']([^"']+)["']/gi, (match, src) => {
        const resolved = resolveAssetUrl(src, assetUrls, assetBaseUrl);
        return `src="${resolved}"`;
    });
}

function isLineFeature(feature) {
    const type = feature.geometry?.type;
    return type === 'LineString' || type === 'MultiLineString';
}

function extractFirstWaypointDate(kmlText) {
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
    const geojson = toGeoJSON.kml(kmlDoc);
    const waypoint = geojson.features.find(isWaypointFeature);
    if (!waypoint) return '';

    const props = waypoint.properties || {};
    let iso = props.timestamp || props.timespan?.begin || '';

    if (!iso) {
        const desc = getDescriptionHtml(props.description);
        const match = desc.match(/Time:\s*(\d{4}-\d{2}-\d{2})/i)
            || desc.match(/(\d{4}-\d{2}-\d{2})T\d{2}:/);
        if (match) iso = match[1];
    }

    if (!iso) return '';

    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function isWaypointFeature(feature) {
    if (feature.geometry?.type !== 'Point') return false;

    const style = String(feature.properties?.styleUrl || '').toLowerCase();
    const desc = getDescriptionHtml(feature.properties?.description);

    if (style.includes('trackpoint')) return false;
    if (style.includes('waypoint') || style.includes('track_begin') || style.includes('track_end')) {
        return true;
    }
    if (/<img\b/i.test(desc)) return true;
    return false;
}

function waypointIcon(feature) {
    const style = String(feature.properties?.styleUrl || '').toLowerCase();
    const hasPhoto = /<img\b/i.test(getDescriptionHtml(feature.properties?.description));
    let cls = 'hiking-waypoint-pin';
    let icon = hasPhoto ? 'bi-camera-fill' : 'bi-geo-alt-fill';

    if (style.includes('track_begin')) {
        cls += ' hiking-waypoint-start';
        icon = 'bi-flag-fill';
    } else if (style.includes('track_end')) {
        cls += ' hiking-waypoint-end';
        icon = 'bi-flag';
    }

    return L.divIcon({
        className: 'hiking-waypoint-marker',
        html: `<div class="${cls}"><i class="bi ${icon}"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -12],
    });
}

function buildWaypointPopup(feature, assetUrls, assetBaseUrl = '') {
    const name = feature.properties?.name || '航點';
    const body = resolveDescriptionHtml(feature.properties?.description, assetUrls, assetBaseUrl);

    return `<div class="hiking-popup">
        <div class="hiking-popup-title">${escapeHtml(name)}</div>
        ${body ? `<div class="hiking-popup-body">${body}</div>` : ''}
    </div>`;
}

function kmlToLayer(kmlText, options = {}) {
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
    const geojson = toGeoJSON.kml(kmlDoc);
    const color = normalizeHexColor(options.color, DEFAULT_TRACK_COLOR);
    const assetUrls = options.assetUrls || {};
    const assetBaseUrl = options.assetBaseUrl || '';
    const group = L.featureGroup();

    const lineFeatures = geojson.features.filter(isLineFeature);
    const waypointFeatures = geojson.features.filter(isWaypointFeature);

    if (lineFeatures.length > 0) {
        const trackLayer = L.geoJSON({ type: 'FeatureCollection', features: lineFeatures }, {
            style: {
                color,
                weight: 4,
                opacity: 0.85,
            },
        });
        group.addLayer(trackLayer);
        group._hikingTrackLayer = trackLayer;
    }

    if (waypointFeatures.length > 0) {
        const waypointLayer = L.geoJSON({ type: 'FeatureCollection', features: waypointFeatures }, {
            pointToLayer(feature, latlng) {
                return L.marker(latlng, { icon: waypointIcon(feature) });
            },
            onEachFeature(feature, featureLayer) {
                featureLayer.bindPopup(buildWaypointPopup(feature, assetUrls, assetBaseUrl), {
                    maxWidth: 340,
                    className: 'hiking-waypoint-popup',
                });
            },
        });
        group.addLayer(waypointLayer);
        group._hikingWaypointLayer = waypointLayer;
    }

    if (lineFeatures.length === 0 && waypointFeatures.length === 0) {
        const fallback = L.geoJSON(geojson, {
            style: { color, weight: 4, opacity: 0.85 },
            pointToLayer(feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 5,
                    fillColor: color,
                    color: '#fff',
                    weight: 1,
                    fillOpacity: 0.9,
                });
            },
            onEachFeature(feature, featureLayer) {
                const name = feature.properties?.name || options.name || '軌跡';
                const desc = resolveDescriptionHtml(feature.properties?.description, assetUrls, assetBaseUrl);
                const popup = desc
                    ? `<strong>${escapeHtml(name)}</strong><br>${desc}`
                    : `<strong>${escapeHtml(name)}</strong>`;
                featureLayer.bindPopup(popup, { maxWidth: 340 });
            },
        });
        group.addLayer(fallback);
        group._hikingTrackLayer = fallback;
    }

    return group;
}

function revokeAssetUrls(assetUrls) {
    const seen = new Set();
    Object.values(assetUrls).forEach(url => {
        if (typeof url === 'string' && url.startsWith('blob:') && !seen.has(url)) {
            seen.add(url);
            URL.revokeObjectURL(url);
        }
    });
}

function addTrack(id, name, layer, meta = {}) {
    if (trackLayers.has(id)) {
        map.removeLayer(trackLayers.get(id).layer);
    }

    if (layer._hikingWaypointLayer) {
        meta.waypointLayer = layer._hikingWaypointLayer;
    }

    trackLayers.set(id, { name, layer, meta, visible: true });
    layer.addTo(map);
    applyWaypointVisibility();
    renderTrackList();
}

function removeTrack(id) {
    const entry = trackLayers.get(id);
    if (entry) {
        map.removeLayer(entry.layer);
        if (entry.meta?.assetUrls) revokeAssetUrls(entry.meta.assetUrls);
        trackLayers.delete(id);
        renderTrackList();
    }
}

function toggleTrack(id, visible, options = {}) {
    const entry = trackLayers.get(id);
    if (!entry) return;

    entry.visible = visible;
    if (visible) {
        entry.layer.addTo(map);
    } else {
        map.removeLayer(entry.layer);
    }
    applyWaypointVisibility();
    if (!options.skipRender) {
        renderTrackList();
    }
}

function setTrackColor(id, color) {
    const entry = trackLayers.get(id);
    if (!entry) return;

    const normalized = normalizeHexColor(color, DEFAULT_TRACK_COLOR);
    entry.meta.color = normalized;

    const trackLayer = entry.layer._hikingTrackLayer;
    if (trackLayer?.setStyle) {
        trackLayer.setStyle({ color: normalized, fillColor: normalized });
    }

    const colorBtn = document.querySelector(`.hiking-track-color-btn[data-track-id="${CSS.escape(id)}"]`);
    const colorInput = document.querySelector(`.hiking-track-color-input[data-track-id="${CSS.escape(id)}"]`);
    if (colorBtn) colorBtn.style.background = normalized;
    if (colorInput) colorInput.value = normalized;
}

function applyWaypointVisibility() {
    trackLayers.forEach(({ layer, meta, visible }) => {
        const waypointLayer = meta.waypointLayer;
        if (!waypointLayer) return;

        const shouldShow = showWaypointIcons && visible;
        const onMap = layer.hasLayer(waypointLayer);
        if (shouldShow && !onMap) {
            layer.addLayer(waypointLayer);
        } else if (!shouldShow && onMap) {
            layer.removeLayer(waypointLayer);
        }
    });
}

function updateWaypointToggleButton() {
    const btn = document.getElementById('toggle-waypoints-btn');
    if (!btn) return;

    btn.classList.toggle('is-active', showWaypointIcons);
    btn.title = showWaypointIcons ? '隱藏航點圖示' : '顯示航點圖示';
    btn.setAttribute('aria-pressed', showWaypointIcons ? 'true' : 'false');
}

function toggleWaypointIcons() {
    showWaypointIcons = !showWaypointIcons;
    applyWaypointVisibility();
    updateWaypointToggleButton();
}

function getLayerBounds(layer) {
    if (!layer) return null;

    const bounds = L.latLngBounds([]);
    const seen = new Set();

    function visit(target) {
        if (!target || seen.has(target)) return;
        seen.add(target);

        if (typeof target.eachLayer === 'function') {
            target.eachLayer(visit);
            return;
        }
        if (typeof target.getLatLng === 'function') {
            bounds.extend(target.getLatLng());
            return;
        }
        if (typeof target.getBounds === 'function') {
            const b = target.getBounds();
            if (b?.isValid()) bounds.extend(b);
        }
    }

    visit(layer);
    return bounds.isValid() ? bounds : null;
}

function fitVisibleTracks() {
    const bounds = L.latLngBounds([]);
    trackLayers.forEach(({ layer, visible }) => {
        if (!visible) return;
        const layerBounds = getLayerBounds(layer);
        if (layerBounds) bounds.extend(layerBounds);
    });
    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

function trackMatchesSearch(entry, query) {
    if (!query) return true;
    const haystack = `${entry.name} ${entry.meta.date || ''}`.toLowerCase();
    return haystack.includes(query);
}

function getFilteredTrackIds() {
    const ids = [];
    trackLayers.forEach((entry, id) => {
        if (trackMatchesSearch(entry, trackSearchQuery)) ids.push(id);
    });
    return ids;
}

function getVisibleTrackCount(ids = null) {
    const targetIds = ids || [...trackLayers.keys()];
    let count = 0;
    targetIds.forEach((id) => {
        if (trackLayers.get(id)?.visible) count += 1;
    });
    return count;
}

function updateToggleAllButton() {
    const btn = document.getElementById('toggle-all-btn');
    if (!btn || trackLayers.size === 0) return;

    const filteredIds = getFilteredTrackIds();
    if (filteredIds.length === 0) {
        btn.textContent = '全選';
        btn.title = '全選';
        return;
    }

    const allVisible = getVisibleTrackCount(filteredIds) === filteredIds.length;
    btn.textContent = allVisible ? '取消全選' : '全選';
    btn.title = allVisible ? '取消全選' : '全選';
}

function toggleAllTracks() {
    const filteredIds = getFilteredTrackIds();
    if (filteredIds.length === 0) return;

    const allVisible = getVisibleTrackCount(filteredIds) === filteredIds.length;
    filteredIds.forEach((id) => {
        toggleTrack(id, !allVisible, { skipRender: true });
    });
    renderTrackList();
}

function renderTrackList() {
    const list = document.getElementById('track-list');
    const searchInput = document.getElementById('track-search');
    if (searchInput && document.activeElement !== searchInput) {
        trackSearchQuery = searchInput.value.trim().toLowerCase();
    }

    if (trackLayers.size === 0) {
        list.innerHTML = '<li class="hiking-track-empty">尚無軌跡。請將 KMZ 放入 static/assets/gps/ 並更新 tracks.yml，或直接上傳檔案。</li>';
        updateToggleAllButton();
        return;
    }

    list.innerHTML = '';
    let visibleCount = 0;

    trackLayers.forEach((entry, id) => {
        const matches = trackMatchesSearch(entry, trackSearchQuery);
        if (!matches) return;

        visibleCount += 1;
        const li = document.createElement('li');
        li.className = 'hiking-track-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = entry.visible;
        checkbox.id = `track-${CSS.escape(id)}`;
        checkbox.addEventListener('change', () => toggleTrack(id, checkbox.checked));

        const trackColor = normalizeHexColor(entry.meta.color, DEFAULT_TRACK_COLOR);
        entry.meta.color = trackColor;

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'hiking-track-color-input';
        colorInput.dataset.trackId = id;
        colorInput.value = trackColor;
        colorInput.addEventListener('input', (e) => setTrackColor(id, e.target.value));
        colorInput.addEventListener('click', (e) => e.stopPropagation());

        const colorBtn = document.createElement('button');
        colorBtn.type = 'button';
        colorBtn.className = 'hiking-track-color-btn';
        colorBtn.dataset.trackId = id;
        colorBtn.style.background = trackColor;
        colorBtn.title = '更改軌跡顏色';
        colorBtn.setAttribute('aria-label', '更改軌跡顏色');
        colorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            colorInput.click();
        });

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.innerHTML = `
            <span class="hiking-track-info">
                <span class="hiking-track-name">${escapeHtml(entry.name)}</span>
                ${entry.meta.date ? `<span class="hiking-track-date">${escapeHtml(entry.meta.date)}</span>` : ''}
            </span>
        `;
        label.addEventListener('click', (e) => {
            if (e.target === checkbox) return;
            const layerBounds = getLayerBounds(entry.layer);
            if (entry.visible && layerBounds) {
                map.fitBounds(layerBounds, { padding: [50, 50] });
            }
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'hiking-btn-remove';
        removeBtn.title = '移除';
        removeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        removeBtn.addEventListener('click', () => removeTrack(id));

        li.append(checkbox, colorBtn, colorInput, label, removeBtn);
        list.appendChild(li);
    });

    if (visibleCount === 0) {
        list.innerHTML = '<li class="hiking-track-empty">找不到符合搜尋條件的軌跡。</li>';
    }

    if (searchInput && document.activeElement !== searchInput) {
        searchInput.value = trackSearchQuery;
    }

    updateToggleAllButton();
}

async function loadTrackFromUrl(track) {
    const color = DEFAULT_TRACK_COLOR;
    const { kmlText, assetUrls, assetBaseUrl } = await extractKmlBundle(track.file, track.file);
    const layer = kmlToLayer(kmlText, { name: track.name, color, assetUrls, assetBaseUrl });
    const id = `saved-${track.file}`;
    addTrack(id, track.name, layer, { date: track.date, color, file: track.file, assetUrls });
}

async function loadManifest() {
    try {
        const response = await fetch(tracksManifestUrl);
        if (!response.ok) throw new Error('manifest not found');
        const yaml = jsyaml.load(await response.text());
        const tracks = yaml?.tracks || [];

        if (tracks.length === 0) {
            renderTrackList();
            return;
        }

        await Promise.all(tracks.map(loadTrackFromUrl));
        fitVisibleTracks();
        syncTrackPanelLayout();
    } catch (err) {
        console.log('No saved tracks:', err);
        renderTrackList();
    }
}

function showGithubStatus(message, type = 'info') {
    const el = document.getElementById('github-status');
    el.hidden = false;
    el.className = `hiking-status hiking-status-${type}`;
    el.textContent = message;
}

function hideGithubStatus() {
    const el = document.getElementById('github-status');
    el.hidden = true;
    el.textContent = '';
}

function initGithubSettings() {
    const config = getGithubConfig();
    document.getElementById('github-repo').value = config.repo;
    document.getElementById('github-branch').value = config.branch;
    if (config.token) {
        document.getElementById('github-token').placeholder = '已儲存（留空則不變更）';
    }

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('track-date-input').value = today;

    document.getElementById('github-save-settings').addEventListener('click', async () => {
        const statusEl = document.getElementById('github-settings-status');
        const tokenInput = document.getElementById('github-token').value.trim();
        const repo = document.getElementById('github-repo').value.trim();
        const branch = document.getElementById('github-branch').value.trim();
        const config = getGithubConfig();

        if (tokenInput) config.token = tokenInput;
        config.repo = repo || DEFAULT_REPO;
        config.branch = branch || DEFAULT_BRANCH;

        statusEl.textContent = '驗證中…';
        try {
            const login = await verifyGithubToken(config);
            saveGithubConfig(config);
            document.getElementById('github-token').value = '';
            document.getElementById('github-token').placeholder = '已儲存（留空則不變更）';
            statusEl.textContent = `已連線：${login}`;
        } catch (err) {
            statusEl.textContent = err.message;
        }
    });

    document.getElementById('github-clear-token').addEventListener('click', () => {
        clearGithubToken();
        document.getElementById('github-token').value = '';
        document.getElementById('github-token').placeholder = 'github_pat_...';
        document.getElementById('github-settings-status').textContent = 'Token 已清除';
    });
}

async function handleFileUpload(files) {
    const saveToGithub = document.getElementById('save-to-github').checked;
    const useFirstWaypointDate = document.getElementById('use-first-waypoint-date').checked;
    const defaultName = document.getElementById('track-name-input').value.trim();
    const manualDate = document.getElementById('track-date-input').value;

    for (const file of files) {
        try {
            const color = DEFAULT_TRACK_COLOR;
            const { kmlText, assetUrls } = await extractKmlBundle(file);
            const displayName = defaultName || file.name.replace(/\.(kmz|kml)$/i, '');
            let trackDate = manualDate;
            if (useFirstWaypointDate) {
                const fromWaypoint = extractFirstWaypointDate(kmlText);
                if (fromWaypoint) trackDate = fromWaypoint;
            }
            const layer = kmlToLayer(kmlText, { name: displayName, color, assetUrls });
            const id = `upload-${file.name}-${Date.now()}`;
            addTrack(id, displayName, layer, { color, date: trackDate, uploaded: true, assetUrls });

            const layerBounds = getLayerBounds(layer);
            if (layerBounds) {
                map.fitBounds(layerBounds, { padding: [50, 50] });
            }

            if (saveToGithub) {
                const config = getGithubConfig();
                const onProgress = (msg) => showGithubStatus(msg, 'info');
                onProgress(`正在處理 ${file.name}…`);

                const { entry, imageCount } = await publishTrackToGithub(file, {
                    name: displayName,
                    date: trackDate || undefined,
                    color,
                }, config, onProgress);

                revokeAssetUrls(assetUrls);
                trackLayers.delete(id);
                const savedId = `saved-${entry.file}`;
                trackLayers.set(savedId, {
                    name: displayName,
                    layer,
                    meta: {
                        color,
                        date: trackDate,
                        file: entry.file,
                        saved: true,
                        assetBaseUrl: trackAssetBaseUrl(entry.file),
                        waypointLayer: layer._hikingWaypointLayer || null,
                    },
                    visible: true,
                });
                applyWaypointVisibility();
                renderTrackList();

                const photoNote = imageCount > 0 ? `（已抽出 ${imageCount} 張圖片）` : '';
                showGithubStatus(
                    `已儲存至 GitHub：${entry.file}${photoNote}。網站約 1–2 分鐘後更新。`,
                    'success'
                );
            }
        } catch (err) {
            console.error(err);
            showGithubStatus(`失敗：${err.message}`, 'error');
        }
    }

    document.getElementById('track-name-input').value = '';
}

document.getElementById('kmz-upload').addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileUpload(e.target.files);
        e.target.value = '';
    }
});

document.getElementById('fit-all-btn').addEventListener('click', fitVisibleTracks);
document.getElementById('toggle-all-btn').addEventListener('click', toggleAllTracks);
document.getElementById('toggle-waypoints-btn').addEventListener('click', toggleWaypointIcons);
document.getElementById('track-search').addEventListener('input', (e) => {
    trackSearchQuery = e.target.value.trim().toLowerCase();
    renderTrackList();
});

function clampSidebarWidth(width) {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function getSidebarWidth() {
    const raw = getComputedStyle(document.body).getPropertyValue('--hiking-sidebar-width').trim();
    return Number.parseInt(raw, 10) || SIDEBAR_DEFAULT_WIDTH;
}

function setSidebarWidth(width, persist = true) {
    const clamped = clampSidebarWidth(width);
    document.body.style.setProperty('--hiking-sidebar-width', `${clamped}px`);
    if (persist) {
        try {
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
        } catch (_) { /* ignore */ }
    }
    map.invalidateSize();
    syncTrackPanelLayout();
}

function initSidebarResize() {
    const resizer = document.getElementById('sidebar-resizer');
    if (!resizer || window.matchMedia('(max-width: 768px)').matches) return;

    const saved = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
    if (Number.isFinite(saved)) {
        setSidebarWidth(saved, false);
    }

    let startX = 0;
    let startWidth = 0;

    const stopResize = () => {
        document.body.classList.remove('is-resizing-sidebar');
        resizer.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
    };

    const onPointerMove = (e) => {
        e.preventDefault();
        setSidebarWidth(startWidth + (e.clientX - startX));
    };

    resizer.addEventListener('pointerdown', (e) => {
        if (window.matchMedia('(max-width: 768px)').matches) return;
        e.preventDefault();
        startX = e.clientX;
        startWidth = getSidebarWidth();
        document.body.classList.add('is-resizing-sidebar');
        resizer.classList.add('is-dragging');
        resizer.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopResize);
        window.addEventListener('pointercancel', stopResize);
    });
}

function syncNavHeight() {
    const nav = document.getElementById('mainNav');
    if (!nav) return;

    const apply = () => {
        const height = Math.ceil(nav.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--hiking-nav-height', `${height}px`);
        map.invalidateSize();
    };

    apply();
    window.addEventListener('load', apply, { once: true });
    document.fonts?.ready?.then(apply);

    if (typeof ResizeObserver !== 'undefined' && !nav._hikingNavObserver) {
        nav._hikingNavObserver = new ResizeObserver(apply);
        nav._hikingNavObserver.observe(nav);
    }
}

function initMobileSidebar() {
    const sidebar = document.getElementById('hiking-sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const closeBtn = document.getElementById('sidebar-close');
    if (!sidebar || !toggle) return;

    const setOpen = (open) => {
        sidebar.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        setTimeout(() => {
            map.invalidateSize();
            syncTrackPanelLayout();
        }, 320);
    };

    toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
    closeBtn?.addEventListener('click', () => setOpen(false));
}

function syncTrackPanelLayout() {
    const panel = document.querySelector('.hiking-track-panel');
    const content = panel?.querySelector('.hiking-track-panel-content');
    const summary = panel?.querySelector('summary');
    const sections = panel?.closest('.hiking-sidebar-sections');
    if (!panel || !content || !summary || !sections) return;

    if (panel.open) {
        const sectionsBottom = sections.getBoundingClientRect().bottom;
        const summaryBottom = summary.getBoundingClientRect().bottom;
        const height = sectionsBottom - summaryBottom;
        content.style.height = `${Math.max(height, 0)}px`;
    } else {
        content.style.height = '';
    }
}

function initTrackPanelLayout() {
    const panel = document.querySelector('.hiking-track-panel');
    const sidebar = document.getElementById('hiking-sidebar');
    if (!panel) return;

    panel.addEventListener('toggle', () => {
        requestAnimationFrame(() => {
            syncTrackPanelLayout();
            requestAnimationFrame(syncTrackPanelLayout);
        });
    });

    window.addEventListener('resize', syncTrackPanelLayout);

    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => syncTrackPanelLayout());
        if (sidebar) observer.observe(sidebar);
        observer.observe(panel);
        const sections = panel.closest('.hiking-sidebar-sections');
        if (sections) observer.observe(sections);
    }

    syncTrackPanelLayout();
}

syncNavHeight();

initSidebarResize();
initTrackPanelLayout();
initMobileSidebar();
initGithubSettings();
updateWaypointToggleButton();
loadManifest();
