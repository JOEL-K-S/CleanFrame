"""Build and sign with the official Tizen SDK."""
from pathlib import Path
import subprocess
import zipfile
from font_assets import write_widget_archive

ROOT = Path(__file__).resolve().parents[1]
SDK = Path('C:/tizen-studio')
CLI = Path('C:/tizen-studio/tools/ide/bin/tizen.bat')
PROFILE_NAME = 'homescreen'

dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
unsigned = dist / 'CleanFrame-unsigned.wgt'
write_widget_archive(unsigned)

signed_dir = dist / 'signed'
signed_dir.mkdir(exist_ok=True)

result = subprocess.run([str(CLI), 'package', '-t', 'wgt', '-s', PROFILE_NAME,
                         '-o', str(signed_dir), '--', str(unsigned)],
                        capture_output=True, text=True)
if result.returncode != 0:
    print(result.stdout)
    print(result.stderr)
    raise SystemExit('SDK signing failed')
else:
    print(result.stdout)
    print('Signed widget created successfully')

signed = signed_dir / unsigned.name
with zipfile.ZipFile(signed) as package:
    if not {'author-signature.xml', 'signature1.xml'}.issubset(package.namelist()):
        raise SystemExit('Package is missing its signing files.')

target = dist / 'CleanFrame.wgt'
target.write_bytes(signed.read_bytes())
print('Signed widget created: ' + str(target))
