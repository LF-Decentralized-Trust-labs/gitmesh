---
"gitmesh-cli": patch
---

`gitmesh doctor` no longer reads or quotes files outside the repository through symlinks (#500). A path that resolves outside the repository root (an absolute symlink target, a `../` target past the root, a chain of links that ends outside, or a file behind a symlinked directory) is inventoried with its literal target and reported broken; doctor never reads it, and never walks a directory that resolves outside the repository. Before this, a committed `CLAUDE.md` symlink to any file the running user could read was quoted in the drift report. User-scope files read with `--user` are not bounded: that flag asks doctor to read this machine's own files.
