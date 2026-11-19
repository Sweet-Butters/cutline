# Cutline

Cutline = VSCodium (MIT) + the Cutline extension (MIT).

This portable Windows x64 demo uses the unmodified official VSCodium
1.100.33714 binary distribution. Cutline.exe is a separate Cutline launcher;
VSCodium's internal product identity and upstream notices are preserved.

Upstream: https://github.com/VSCodium/vscodium/releases/tag/1.100.33714

The original LICENSE and ThirdPartyNotices files remain in their upstream
locations (including resources/app). Cutline's license is CUTLINE-LICENSE.txt.
Other included components retain their respective licenses in the distribution.

No Claude Code, Codex, credentials, or API keys are included. These agents are
installed and authenticated separately by the user. Video processing requires
ffmpeg and ffprobe on PATH; the optional project CLI requires Node.js and git.
The included camera videos and transcripts are synthetic demo material.

Extract the entire ZIP into a writable directory, then run Cutline.exe.
The default project is sample-project. Pass a folder path to open another project.
Settings and extensions live exclusively in the adjacent data directory.
This hackathon launcher is unsigned. No installer or registry changes are used.
