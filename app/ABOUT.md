# Cutline

Cutline = VSCodium (MIT) + the Cutline extension (MIT).

This portable Windows x64 demo is based on the official VSCodium
1.100.33714 binary distribution. The executable icon resources, display name
and Windows app identity are branded as Cutline. Cutline.exe is a separate
launcher. Upstream license and third-party notices are preserved.

Upstream: https://github.com/VSCodium/vscodium/releases/tag/1.100.33714

The original LICENSE and ThirdPartyNotices files remain in their upstream
locations (including resources/app). Cutline's license is CUTLINE-LICENSE.txt.
Other included components retain their respective licenses in the distribution.

No Claude Code, Codex, credentials, or API keys are included. These agents are
installed and authenticated separately by the user. Video processing requires
ffmpeg and ffprobe on PATH; the optional project CLI requires Node.js and git.
The included camera videos and transcripts are synthetic demo material.

Extract the entire ZIP into a writable directory, then run Cutline.exe.
On first launch the sample is copied to Documents/Cutline/sample-project.
Existing user edits are preserved. Pass a folder path to open another project.
Settings, extensions and proxies live in the adjacent data directory.
This hackathon launcher is unsigned. No installer or registry changes are used.
