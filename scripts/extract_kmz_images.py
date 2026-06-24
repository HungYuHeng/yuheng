#!/usr/bin/env python3
"""
從 KMZ 抽出圖片，另存為資料夾，並產生不含圖片的輕量 KML。
（hiking.html 上傳至 GitHub 時會在瀏覽器自動執行相同流程；此腳本供本機批次處理用）

用法：
  python scripts/extract_kmz_images.py static/assets/gps/2026-06-19東埔大水窟Day1-2.kmz

產出：
  static/assets/gps/北坑溪古道/          ← 圖片資料夾
  static/assets/gps/北坑溪古道.kml       ← 軌跡 + 航點（圖片改為外部路徑）

可選壓縮（建議，方便 push 到 GitHub）：
  python scripts/extract_kmz_images.py static/assets/gps/北坑溪古道.kmz --max-size 1280 --quality 82
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from pathlib import Path

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def slug_from_kmz(path: Path) -> str:
    return path.stem


def maybe_compress(data: bytes, filename: str, max_size: int | None, quality: int) -> bytes:
    if not max_size:
        return data
    ext = Path(filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png"}:
        return data
    try:
        from PIL import Image
    except ImportError:
        print("警告：未安裝 Pillow，略過壓縮。可執行 pip install Pillow", file=sys.stderr)
        return data

    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def rewrite_image_paths(kml_text: str, folder_name: str) -> str:
    def repl(match: re.Match[str]) -> str:
        src = match.group(1)
        base = Path(src.replace("\\", "/")).name
        return f'src="{folder_name}/{base}"'

    return re.sub(r'src=["\']([^"\']+)["\']', repl, kml_text, flags=re.IGNORECASE)


def extract(kmz_path: Path, out_root: Path, max_size: int | None, quality: int) -> tuple[Path, Path]:
    folder_name = slug_from_kmz(kmz_path)
    image_dir = out_root / folder_name
    image_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(kmz_path, "r") as zf:
        kml_names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
        if not kml_names:
            raise SystemExit("KMZ 內找不到 KML")
        kml_name = kml_names[0]
        kml_text = zf.read(kml_name).decode("utf-8", errors="replace")

        saved = 0
        for info in zf.infolist():
            if info.is_dir():
                continue
            ext = Path(info.filename).suffix.lower()
            if ext not in IMAGE_EXT:
                continue
            data = zf.read(info.filename)
            out_name = Path(info.filename).name
            if max_size and ext in {".jpg", ".jpeg", ".png"}:
                data = maybe_compress(data, out_name, max_size, quality)
                out_name = Path(out_name).with_suffix(".jpg").name
            (image_dir / out_name).write_bytes(data)
            saved += 1

    kml_text = rewrite_image_paths(kml_text, folder_name)
    kml_path = out_root / f"{folder_name}.kml"
    kml_path.write_text(kml_text, encoding="utf-8")

    return image_dir, kml_path, saved


def main() -> None:
    parser = argparse.ArgumentParser(description="從 KMZ 抽出圖片並產生輕量 KML")
    parser.add_argument("kmz", type=Path, help="KMZ 檔案路徑")
    parser.add_argument("--max-size", type=int, default=1280, help="圖片最長邊像素（0=不壓縮）")
    parser.add_argument("--quality", type=int, default=82, help="JPEG 品質 1-95")
    parser.add_argument("--no-compress", action="store_true", help="不壓縮，原尺寸抽出")
    args = parser.parse_args()

    kmz_path = args.kmz.resolve()
    if not kmz_path.exists():
        raise SystemExit(f"找不到檔案：{kmz_path}")

    max_size = None if args.no_compress or args.max_size <= 0 else args.max_size
    out_root = kmz_path.parent

    image_dir, kml_path, count = extract(kmz_path, out_root, max_size, args.quality)

    def mb(p: Path) -> float:
        if p.is_file():
            return p.stat().st_size / 1024 / 1024
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1024 / 1024

    print(f"圖片資料夾：{image_dir}（{count} 張，約 {mb(image_dir):.1f} MB）")
    print(f"輕量 KML：  {kml_path}（約 {mb(kml_path):.2f} MB）")
    print()
    print("下一步：")
    print(f"  1. 在 contents/hiking/tracks.yml 將 file 改為：{kml_path.as_posix()}")
    print(f"  2. 不要把原始 KMZ（{kmz_path.name}）commit 到 GitHub")
    print(f"  3. git add {image_dir.as_posix()} {kml_path.as_posix()}")


if __name__ == "__main__":
    main()
