const GITHUB_API = 'https://api.github.com';
const GPS_DIR = 'static/assets/gps';
const MANIFEST_PATH = 'contents/hiking/tracks.yml';
const DEFAULT_REPO = 'HungYuHeng/yuheng.github.io';
const DEFAULT_BRANCH = 'main';
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const EXTRACT_MAX_SIZE = 1280;
const EXTRACT_QUALITY = 0.82;

function getGithubConfig() {
    return {
        token: localStorage.getItem('hiking_github_token') || '',
        repo: localStorage.getItem('hiking_github_repo') || DEFAULT_REPO,
        branch: localStorage.getItem('hiking_github_branch') || DEFAULT_BRANCH,
    };
}

function saveGithubConfig({ token, repo, branch }) {
    if (token) localStorage.setItem('hiking_github_token', token);
    if (repo) localStorage.setItem('hiking_github_repo', repo);
    if (branch) localStorage.setItem('hiking_github_branch', branch);
}

function clearGithubToken() {
    localStorage.removeItem('hiking_github_token');
}

function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function base64ToUtf8(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

async function fileToBase64(file) {
    return blobToBase64(file);
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_').replace(/_+/g, '_');
}

function parseRepo(repo) {
    const [owner, name] = repo.split('/');
    if (!owner || !name) throw new Error('Repo 格式應為 owner/repo');
    return { owner, name };
}

function findKmlInZip(zip) {
    const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
    if (!kmlFile) throw new Error('KMZ 檔案中找不到 KML');
    return kmlFile;
}

async function githubRequest(path, { token, method = 'GET', body } = {}) {
    const res = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub API 錯誤 (${res.status})`);
    }

    if (res.status === 204) return null;
    return res.json();
}

async function compressImageBlob(blob, maxSize, quality) {
    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest > maxSize) {
        const scale = maxSize / longest;
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('圖片壓縮失敗'))), 'image/jpeg', quality);
    });
}

function rewriteImagePaths(kmlText, folderName, nameMap) {
    return kmlText.replace(/src=["']([^"']+)["']/gi, (match, src) => {
        const base = src.replace(/\\/g, '/').split('/').pop();
        const outName = nameMap.get(base) || base;
        return `src="${folderName}/${outName}"`;
    });
}

async function extractKmzForPublish(file, onProgress) {
    onProgress?.('正在解析 KMZ…');
    const zip = await JSZip.loadAsync(file);
    const kmlFile = findKmlInZip(zip);
    let kmlText = await zip.file(kmlFile).async('text');
    const folderName = sanitizeFilename(file.name.replace(/\.kmz$/i, '')) || 'track';

    const images = [];
    const nameMap = new Map();
    const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir && IMAGE_EXT.test(entry.name));

    for (let i = 0; i < entries.length; i++) {
        const [path, zipEntry] = entries[i];
        const originalName = path.replace(/\\/g, '/').split('/').pop();
        onProgress?.(`壓縮圖片 ${i + 1}/${entries.length}…`);

        let blob = await zipEntry.async('blob');
        let outName = originalName;
        if (/\.(jpe?g|png)$/i.test(originalName)) {
            blob = await compressImageBlob(blob, EXTRACT_MAX_SIZE, EXTRACT_QUALITY);
            outName = originalName.replace(/\.(jpe?g|png)$/i, '.jpg');
        }

        images.push({
            path: `${GPS_DIR}/${folderName}/${outName}`,
            base64: await blobToBase64(blob),
        });
        nameMap.set(originalName, outName);
    }

    kmlText = rewriteImagePaths(kmlText, folderName, nameMap);
    const kmlPath = `${GPS_DIR}/${folderName}.kml`;

    return { folderName, kmlPath, kmlText, images };
}

async function getFileMeta(owner, repo, path, config) {
    return githubRequest(
        `/repos/${owner}/${repo}/contents/${path}?ref=${config.branch}`,
        { token: config.token }
    );
}

async function putFile(owner, repo, path, contentBase64, message, config, sha) {
    return githubRequest(`/repos/${owner}/${repo}/contents/${path}`, {
        token: config.token,
        method: 'PUT',
        body: {
            message,
            content: contentBase64,
            branch: config.branch,
            ...(sha ? { sha } : {}),
        },
    });
}

async function createGitBlob(owner, repo, contentBase64, config) {
    const blob = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, {
        token: config.token,
        method: 'POST',
        body: { content: contentBase64, encoding: 'base64' },
    });
    return blob.sha;
}

async function buildManifestContent(track, config) {
    const { owner, name: repo } = parseRepo(config.repo);
    let tracks = [];

    try {
        const existing = await getFileMeta(owner, repo, MANIFEST_PATH, config);
        const parsed = jsyaml.load(base64ToUtf8(existing.content));
        tracks = parsed?.tracks || [];
    } catch {
        // new manifest
    }

    if (!tracks.some(t => t.file === track.file)) tracks.push(track);

    return `# 登山 GPS 軌跡清單\n# 由 hiking.html 自動維護\n\n${jsyaml.dump({ tracks }, { lineWidth: -1, noRefs: true })}`;
}

async function publishFilesInOneCommit(files, message, config, onProgress) {
    const { owner, name: repo } = parseRepo(config.repo);

    const ref = await githubRequest(
        `/repos/${owner}/${repo}/git/ref/heads/${config.branch}`,
        { token: config.token }
    );
    const parentSha = ref.object.sha;
    const parentCommit = await githubRequest(
        `/repos/${owner}/${repo}/git/commits/${parentSha}`,
        { token: config.token }
    );

    onProgress?.('正在上傳至 GitHub…');
    const treeItems = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (files.length > 3 && i % 10 === 0) {
            onProgress?.(`建立檔案 ${i + 1}/${files.length}…`);
        }
        const sha = await createGitBlob(owner, repo, file.base64, config);
        treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha });
    }

    const tree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
        token: config.token,
        method: 'POST',
        body: { base_tree: parentCommit.tree.sha, tree: treeItems },
    });

    const commit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
        token: config.token,
        method: 'POST',
        body: { message, tree: tree.sha, parents: [parentSha] },
    });

    await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${config.branch}`, {
        token: config.token,
        method: 'PATCH',
        body: { sha: commit.sha },
    });

    return commit;
}

async function uploadGpsFile(file, config) {
    const { owner, name: repo } = parseRepo(config.repo);
    const ext = file.name.match(/\.(kmz|kml)$/i)?.[0]?.toLowerCase() || '.kmz';
    const baseName = sanitizeFilename(file.name.replace(/\.(kmz|kml)$/i, '')) || 'track';
    const gpsPath = `${GPS_DIR}/${baseName}${ext}`;

    let sha;
    try {
        const existing = await getFileMeta(owner, repo, gpsPath, config);
        sha = existing.sha;
    } catch {
        // new file
    }

    await putFile(
        owner, repo, gpsPath,
        await fileToBase64(file),
        `Add hiking GPS track: ${file.name}`,
        config, sha
    );

    return gpsPath;
}

async function appendTrackToManifest(track, config) {
    const { owner, name: repo } = parseRepo(config.repo);
    const content = await buildManifestContent(track, config);

    let sha;
    try {
        const existing = await getFileMeta(owner, repo, MANIFEST_PATH, config);
        sha = existing.sha;
    } catch {
        // new manifest
    }

    await putFile(
        owner, repo, MANIFEST_PATH,
        utf8ToBase64(content),
        `Update hiking tracks manifest: ${track.name}`,
        config, sha
    );
}

async function publishKmzExtracted(file, meta, config, onProgress) {
    const { kmlPath, kmlText, images } = await extractKmzForPublish(file, onProgress);

    const entry = { name: meta.name, file: kmlPath };
    if (meta.date) entry.date = meta.date;
    if (meta.color) entry.color = meta.color;

    const manifestText = await buildManifestContent(entry, config);
    const files = [
        ...images.map(img => ({ path: img.path, base64: img.base64 })),
        { path: kmlPath, base64: utf8ToBase64(kmlText) },
        { path: MANIFEST_PATH, base64: utf8ToBase64(manifestText) },
    ];

    await publishFilesInOneCommit(
        files,
        `Add hiking track: ${meta.name} (${images.length} photos)`,
        config,
        onProgress
    );

    return { gpsPath: kmlPath, entry, imageCount: images.length };
}

async function publishTrackToGithub(file, meta, config, onProgress) {
    if (!config.token) throw new Error('請先在 GitHub 設定中輸入 Personal Access Token');

    if (file.name.toLowerCase().endsWith('.kmz')) {
        return publishKmzExtracted(file, meta, config, onProgress);
    }

    onProgress?.('正在上傳至 GitHub…');
    const gpsPath = await uploadGpsFile(file, config);
    const entry = { name: meta.name, file: gpsPath };
    if (meta.date) entry.date = meta.date;
    if (meta.color) entry.color = meta.color;

    await appendTrackToManifest(entry, config);
    return { gpsPath, entry, imageCount: 0 };
}

async function verifyGithubToken(config) {
    if (!config.token) throw new Error('請輸入 Token');
    const user = await githubRequest('/user', { token: config.token });
    const { owner, name: repo } = parseRepo(config.repo);
    await githubRequest(`/repos/${owner}/${repo}`, { token: config.token });
    return user.login;
}
