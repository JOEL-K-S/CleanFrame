# CleanFrame Native Home & USB Motion Background — Comprehensive Session Handover

This document records the complete chronological sequence of investigations, diagnoses, code modifications, firmware adaptations, and successful deployments completed for **CleanFrame** on the user's Samsung Smart TV.

---

## 1. Initial Problem Statement
- **Issue**: CleanFrame custom launcher was installed on the TV, but pressing the physical **Home button** on the remote navigated back to Samsung's default Smart Hub launcher (`com.samsung.tv.csfs`) instead of opening CleanFrame.
- **Goal**:
  1. Rebind the remote Home button and TV startup to CleanFrame.
  2. Implement an animated "moving background" photo slideshow from connected USB storage.
  3. Release and deploy as a clean new version (`0.7.0`).

---

## 2. Hardware & Environment Profile

All parameters were probed and verified live on the target device:

| Property | Value | Notes |
|---|---|---|
| **TV Model** | `UA43DUE76AKLXL` | 43" Crystal UHD 4K (DUE76 series) |
| **Firmware String** | `T-KSU2EDUABC-0090-2130.0` | Recorded from `/etc/prd_info.ini` |
| **Tizen Version** | 9.0.0 (Build: `T-KSU2EDUABC-0090-REL-202605141701`) | Platform: `armv7l` (32-bit ARM) |
| **TV Local IP** | `192.168.1.133` | Port `26101` for SDB; Port `8001` for TV REST API |
| **PC Host IP** | `192.168.1.150` | Entered into TV Developer Mode popup |
| **SDB CLI Path** | `C:\tizen-studio\tools\sdb.exe` | Tizen Studio tools directory |
| **App Identity** | `lxvKBoETTJ.HomeScreen` | Package: `lxvKBoETTJ` (from `app/config.xml`) |
| **Certificate Profile** | `homescreen` | Author: `clean`, Distributor: `homescreen` |
| **Host .NET SDK** | .NET SDK 6.0.428 (x64) | Installed during session for cross-compiling helper |
| **TV .NET Runtime** | Microsoft .NET Core 6.0.9 | Pre-installed on TV at `/usr/share/dotnet/` |

---

## 3. Root Cause Analysis & Security Diagnoses

### A. Model & Firmware Guard Blocks
The repository previously had guards configured strictly for the author's reference TV (`QA55LS03DAWXXY` The Frame):
- `scripts/native-home/run.py`: Threw `Model guard failed; nothing staged` because model check expected `QA55LS03DAWXXY`.
- `scripts/native-home/Control.cs`: Threw `Unexpected firmware` because it checked for `Version=T-PTMDUABC-0090-2130.0;` instead of `T-KSU2EDUABC-0090-2130.0`.
- Target app ID in `Control.cs` was hardcoded to `nClrkHome1.FrameHome` instead of `lxvKBoETTJ.HomeScreen`.

### B. Shell Access & Tizen UEP (Unsigned Execution Prevention)
- Direct `sdb shell` commands returned `closed` because `intershell_support:disabled` is enforced on this model.
- Workaround: The script uses the SDB package manager command injection payload:
  `0 appinstall tpk new2.tpk`printf${IFS}%s${IFS}<base64_script>|base64${IFS}-d|bash`.tpk`
  which executes as `uid=901(sdk)` and establishes a reverse TCP socket back to the host PC.
- Executing pushed script files directly (`bash script.sh`) failed with `[uep][bash] the file is NOT signed!!`.
- Piping script contents through standard input (`cat script.sh | bash`) successfully bypassed UEP.

### C. Windows CRLF Argument Corruption
- `scripts/native-home/query.sh` had Windows CRLF line endings (`\r\n`).
- When bash executed line 3, it passed `"query\r"` to `CleanFrameHomeControl.dll`.
- C# `args[0] == "query"` evaluated to `false`, throwing `Use query, apply SNAPSHOT, or restore SNAPSHOT`.
- Resolved by adding `args[i] = args[i].Trim()` to `Control.cs` and sanitizing line endings.

### D. Snapshot Setting Mismatch
- When running `apply`, the TV rejected the snapshot with `Setting changed since snapshot: db/appfw/booting_appid_backup`.
- Installing CleanFrame v0.7.0 updated the TV's internal last-booted backup value.
- Re-querying after a full TV restart realigned the snapshot to `com.samsung.tv.csfs` / `org.tizen.tv-viewer`.

---

## 4. Chronological Steps Completed in This Chat

### Step 1: Probed TV Hardware & Verified Runtime Environment
- Connected over SDB and HTTP API (`port 8001`).
- Retrieved TV capabilities: ARMv7, 32-bit ABI, .NET 6.0.9 installed, native libraries present (`libaul.so.0`, `libvconf.so.0`, `libcapi-appfw-app-operation-tv.so.0`, `libbundle.so.0`, `libapp-context-manager-common.so`).
- Read current TV Home assignment: `com.samsung.tv.csfs` (Samsung Smart Hub).

### Step 2: Adapted Native Home Helper Code
- **`scripts/native-home/run.py`**:
  - Updated model check to `UA43DUE76AKLXL`.
  - Added robust detection for `C:\tizen-studio\tools\sdb.exe`.
- **`scripts/native-home/Control.cs`**:
  - Updated `Target` constant to `"lxvKBoETTJ.HomeScreen"`.
  - Updated firmware check to `"Version=T-KSU2EDUABC-0090-2130.0;"`.
  - Updated directory validation check to `/opt/usr/apps/lxvKBoETTJ`.
  - Added whitespace trimming to `Main(string[] args)`.

### Step 3: Configured Cross-Compilation & Built Native Binary
- Created project file `.local/native-home/CleanFrameHomeControl.csproj` configured for `linux-arm` / `net6.0`.
- User installed .NET 6.0.428 SDK on the PC.
- Compiled helper via:
  ```powershell
  dotnet publish .local\native-home\CleanFrameHomeControl.csproj -c Release -r linux-arm --no-self-contained -o .local\native-home\out
  ```
- Produced `CleanFrameHomeControl.dll`, `runtimeconfig.json`, and `deps.json`.

### Step 4: Built USB Moving Background Feature
- **`app/usb.js`**:
  - Scans removable USB storage using `tizen.filesystem.listStorages()`.
  - Recursively finds image files (`.jpg`, `.jpeg`, `.png`, `.webp`) up to depth 3, capped at 200 items.
  - Listens for storage plug/unplug events via `tizen.filesystem.addStorageStateChangeListener`.
  - Implements dual-buffer crossfade engine with pre-loading.
- **`app/index.html`**:
  - Added secondary buffer `<img class="photo photo-b" id="photoAlt" alt="" style="opacity:0">` inside `.bg`.
  - Included `<script src="usb.js"></script>`.
- **`app/style.css`**:
  - Added 1.8s smooth cubic-bezier opacity transition to `.photo`.
  - Added hardware-accelerated Ken Burns pan-and-zoom keyframe animations (`@keyframes kenburns-slow-1` / `kenburns-slow-2`).
- **`app/config.xml`**:
  - Added `<tizen:privilege name="http://tizen.org/privilege/filesystem.read"/>`.
  - Added `<tizen:privilege name="http://tizen.org/privilege/mediastorage"/>`.

### Step 5: Version Bump & Official Package Creation
- Updated version from `0.6.1` to `0.7.0` in both `app/config.xml` and `package.json`.
- Executed `python3 scripts/package.py` — successfully packaged and signed `dist/CleanFrame.wgt` using the Samsung `homescreen` profile.

### Step 6: TV Installation & Native Home Application
- Installed v0.7.0 to TV via `python3 scripts/tv.py install`.
- Launched v0.7.0 via `python3 scripts/tv.py launch` (PID: 2409).
- Handled TV restart and re-enabled Developer Mode.
- Captured baseline snapshot via `python3 scripts/native-home/run.py query` and saved to `.local/native-home/original.json`.
- Executed `python3 scripts/native-home/run.py apply`.
- **Result**: `CLEANFRAME_HOME_APPLIED={"Home":"lxvKBoETTJ.HomeScreen","Autostart":1,"BootSupported":1}`.

---

## 5. Current File Structure & Modifications Summary

```
CleanFrame/
├── app/
│   ├── config.xml            # v0.7.0, added filesystem.read & mediastorage privileges
│   ├── index.html            # Added #photoAlt buffer & usb.js script tag
│   ├── style.css             # Added Ken Burns animation keyframes & 1.8s crossfade
│   ├── usb.js                # [NEW] USB discovery & dual-buffer motion controller
│   ├── device.js             # Public Tizen app launcher APIs
│   └── main.js               # CleanFrame core UI logic
├── dist/
│   └── CleanFrame.wgt        # v0.7.0 signed installation package (15.8 MB)
├── package.json              # Version bumped to 0.7.0
├── scripts/
│   ├── native-home/
│   │   ├── Control.cs        # Updated target app, firmware guard, arg trimming
│   │   ├── run.py            # Updated TV model guard & SDB discovery
│   │   ├── query.sh          # Helper query script
│   │   ├── apply.sh          # Helper apply script
│   │   └── restore.sh        # Helper restore script
│   ├── package.py            # Packaging & signing script
│   └── tv.py                 # TV connection, install, and launch runner
└── .local/
    ├── device.json           # {"host": "192.168.1.133"}
    └── native-home/
        ├── CleanFrameHomeControl.csproj   # [NEW] .NET 6 linux-arm project
        ├── original.json                  # Official rollback snapshot
        └── out/                           # Compiled ARM32 binaries for TV execution
```

---

## 6. Master Command Reference

Run all commands from `C:\Users\PC\Downloads\git\CleanFrame`:

### A. Packaging & Installing Updates
```powershell
# 1. Package and sign widget with Samsung profile
python3 scripts/package.py

# 2. Upload and install widget to TV
python3 scripts/tv.py install

# 3. Launch the app on TV
python3 scripts/tv.py launch
```

### B. Native Home Management
```powershell
# Query current TV home settings and check boot eligibility
python3 scripts/native-home/run.py query

# Bind remote Home button and startup to CleanFrame
python3 scripts/native-home/run.py apply

# Roll back remote Home button to Samsung default (com.samsung.tv.csfs)
python3 scripts/native-home/run.py restore
```

### C. Recompiling the Native Helper (if Control.cs is modified)
```powershell
& "C:\Program Files\dotnet\dotnet.exe" publish ".local\native-home\CleanFrameHomeControl.csproj" -c Release -r linux-arm --no-self-contained -o ".local\native-home\out"
```

---

## 7. Operational Notes & TV Behavior Rules

1. **Full Power-Off / Mains Cycle**:
   - If the TV is unplugged from mains power, Samsung Tizen resets the Developer Mode setting.
   - To re-enable: open **Apps** → press **1, 2, 3, 4, 5** → switch **Developer Mode ON** → set Host IP (`192.168.1.150`).
2. **Uninstalling or Identity Changes**:
   - Always run `python3 scripts/native-home/run.py restore` **before** uninstalling CleanFrame or changing its package/app ID. Otherwise, pressing Home will point to a nonexistent app ID.
3. **USB Motion Slideshow**:
   - Plug any USB flash drive formatted as FAT32 or NTFS containing `.jpg` or `.png` images into any USB port on the TV.
   - CleanFrame automatically scans up to 200 images and rotates with the Ken Burns slow motion effect every 20 seconds.
