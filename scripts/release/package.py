#!/usr/bin/env python3
"""Create a release from tracked application files and the verified Vite build."""
import argparse
import hashlib
import json
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def managed_path(name):
    p = Path(name)
    if p.is_absolute() or ".." in p.parts or "\\" in name:
        return False
    if any(part.startswith(".") or part in {"node_modules", "uploads", "dist"} for part in p.parts):
        return False
    if name.startswith("backend/"):
        return p.suffix in {".js", ".py"} or name in {"backend/package.json", "backend/package-lock.json"}
    if name.startswith("frontend/"):
        return p.suffix.lower() not in {".md", ".txt"}
    return name == "VERSION"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", args.tag):
        parser.error("Use a stable vMAJOR.MINOR.PATCH release tag")
    if not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        parser.error("A full commit SHA is required")
    root = Path(__file__).resolve().parents[2]
    dist = root / "frontend/dist"
    if not all((dist / name).is_file() for name in ("index.html", "manage/index.html")):
        raise RuntimeError("Both public and administrator builds are required")
    version = {"version": args.tag[1:], "tag": args.tag, "commit": args.commit,
               "builtAt": datetime.now(timezone.utc).isoformat()}
    (dist / "version.json").write_text(json.dumps(version, indent=2) + "\n", encoding="utf-8")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    names = sorted(set(n for n in tracked if n and managed_path(n)) | {"VERSION"})
    # VERSION in source records the Android build default; the release marker records the actual tag.
    sources = {"app/" + n: root / n for n in names}
    sources.update({"app/frontend/dist/" + p.relative_to(dist).as_posix(): p
                    for p in dist.rglob("*") if p.is_file()})
    sources.update({"scripts/release/" + p.name: p for p in (root / "scripts/release").iterdir()
                    if p.is_file() and p.suffix in {".py", ".cjs", ".json"} and ".test." not in p.name})
    for name, path in sources.items():
        if path.is_symlink() or any(part in {".env", "node_modules", "uploads"} for part in Path(name).parts):
            raise RuntimeError("Unsafe release input: " + name)
    manifest = {**version, "format": 1, "managed": names,
                "files": {n: digest(p) for n, p in sorted(sources.items())}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest_file = args.output.parent / "release-manifest.json"
    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    with tarfile.open(args.output, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for name, path in sorted(sources.items()):
            archive.add(path, arcname=name, recursive=False)
        archive.add(manifest_file, arcname="release-manifest.json")
    checksum = digest(args.output)
    args.output.with_name(args.output.name + ".sha256").write_text(
        checksum + "  " + args.output.name + "\n", encoding="ascii")
    print(json.dumps({"tag": args.tag, "commit": args.commit, "files": len(sources), "sha256": checksum}))


if __name__ == "__main__":
    main()
