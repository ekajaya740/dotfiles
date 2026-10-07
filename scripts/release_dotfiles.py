#!/usr/bin/env python3
"""Release the dotfiles by tagging the version at the top of CHANGELOG.md.

This repository has a single version, carried by the newest `## [x.y.z]`
heading in CHANGELOG.md. Compare it against the tags that already exist: if
that version has no tag yet, it has been bumped and is due for a release.

    python3 scripts/release_dotfiles.py --check
        Print what would be released and exit. Writes nothing. Exits 1 if
        something is due or the changelog is malformed, so a workflow can use
        it as a gate.

    python3 scripts/release_dotfiles.py --tag
        Create the annotated tag locally (no push; the workflow pushes).

The tag is `dotfiles-vX.Y.Z` and the GitHub Release body comes from the
matching changelog section, so a release can never be announced without notes.

The parser is deliberately strict: it fails closed. A malformed version, a
duplicate heading, or a version that is out of order relative to the previous
one is an error rather than a silent no-op, because the failure mode of a
lenient release script is a wrong tag on a public repo.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHANGELOG = REPO / "CHANGELOG.md"

VERSION_RE = re.compile(r"^##\s+\[(\d+\.\d+\.\d+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$")
TAG_PREFIX = "dotfiles-v"


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(("git", *args), cwd=REPO, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed:\n{result.stderr}")
    return result.stdout


def tag_identity() -> list[str]:
    """`-c` overrides for tagging, so this works without a configured identity.

    An annotated tag records a tagger, and a CI runner has no user.name or
    user.email set, so `git tag -a` fails with "empty ident name". Supplying
    the identity inline means the release does not depend on the caller having
    configured one. An existing local identity is still honoured.
    """
    name = git("config", "user.name", check=False).strip()
    email = git("config", "user.email", check=False).strip()
    if name and email:
        return []
    return [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    ]


def sections() -> list[tuple[str, str | None, str]]:
    """Every `## [x.y.z]` heading, as (version, date, notes), newest first.

    Raises on anything that would make the release ambiguous: a heading whose
    version is not `x.y.z`, a repeated version, or a section with no notes.
    """
    if not CHANGELOG.exists():
        raise SystemExit(f"{CHANGELOG.name} not found at {CHANGELOG}")

    found: list[tuple[str, str | None, str]] = []
    current: tuple[str, str | None] | None = None
    body: list[str] = []

    # A trailing link-reference definition (`[1.0.0]: https://...`) belongs to the
    # document, not to the section above it. Without this it is captured as the
    # last line of the newest release's notes and printed verbatim in the GitHub
    # release. Note refs sit at column 0; indented lines are ordinary content.
    link_ref = re.compile(r"^\[[^\]]+\]:\s")

    for line in CHANGELOG.read_text().splitlines():
        if line.startswith("## "):
            if current is not None:
                found.append((*current, "\n".join(body).strip()))
            match = VERSION_RE.match(line)
            if match is None:
                raise SystemExit(
                    f"malformed release heading: {line!r}\n"
                    f"expected e.g. '## [1.2.3] - 2026-01-01'"
                )
            current = (match.group(1), match.group(2))
            body = []
        elif current is not None and link_ref.match(line):
            continue
        elif current is not None:
            body.append(line)

    if current is not None:
        found.append((*current, "\n".join(body).strip()))

    if not found:
        raise SystemExit("no '## [x.y.z]' release heading found in CHANGELOG.md")

    versions = [version for version, _, _ in found]
    duplicates = {v for v in versions if versions.count(v) > 1}
    if duplicates:
        raise SystemExit(f"duplicate version heading(s): {', '.join(sorted(duplicates))}")

    for version, _, notes in found:
        if not notes:
            raise SystemExit(f"version {version} has no release notes under its heading")

    return found


def is_newer(new: str, old: str) -> bool:
    return tuple(int(p) for p in new.split(".")) > tuple(int(p) for p in old.split("."))


def newest() -> tuple[str, str | None, str]:
    """The version due for release, after checking the changelog is coherent."""
    found = sections()

    # Newest first, so each version must be greater than the one after it.
    for (newer, _, _), (older, _, _) in zip(found, found[1:]):
        if not is_newer(newer, older):
            raise SystemExit(
                f"versions out of order: {newer} appears above {older}; "
                f"the newest release must be first"
            )

    return found[0]


def tag_name(version: str) -> str:
    return f"{TAG_PREFIX}{version}"


def repo_slug() -> str:
    remote = git("remote", "get-url", "origin").strip()
    match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", remote)
    return match.group(1) if match else "ekajaya740/dotfiles"


def release_body(version: str, date: str | None, notes: str) -> str:
    heading = f"dotfiles {version}" + (f" ({date})" if date else "")
    return (
        f"{heading}\n\n"
        f"{notes}\n\n"
        f"---\n"
        f"Full tree: https://github.com/{repo_slug()}/tree/{tag_name(version)}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report pending release")
    mode.add_argument("--tag", action="store_true", help="create the pending tag")
    args = parser.parse_args()

    version, date, notes = newest()
    tag = tag_name(version)

    if tag in set(git("tag", "--list").splitlines()):
        print(f"  tagged  {tag}")
        print("\nNothing to release.")
        return 0

    print(f"  DUE     {tag}")
    print(f"\nRelease {tag} is due.")

    if args.check:
        return 0

    git(*tag_identity(), "tag", "-a", tag, "-m", release_body(version, date, notes), check=True)
    print(f"  created {tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
