# Regenerates .github/workflows/android.yml so that the workflow alone can build the app:
# the Android project is packed into the yml (tar.xz + base64, checked with sha256), then the
# web interface (public/) is copied inside the APK and Gradle builds it.
import base64, hashlib, io, lzma, os, tarfile
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
skip = {'README.md', 'make_workflow.py'}
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w', format=tarfile.GNU_FORMAT) as tar:
    for d, dirs, files in sorted(os.walk(here)):
        dirs.sort()
        for f in sorted(files):
            if f in skip or d.endswith(('build', '.gradle')):
                continue
            p = os.path.join(d, f)
            info = tar.gettarinfo(p, arcname=os.path.relpath(p, root))
            info.uid = info.gid = 0; info.uname = info.gname = ''; info.mtime = 0
            with open(p, 'rb') as fh:
                tar.addfile(info, fh)
data = lzma.compress(buf.getvalue(), preset=9 | lzma.PRESET_EXTREME)
sha = hashlib.sha256(data).hexdigest()
b64 = base64.b64encode(data).decode()
ind = '          '
lines = [ind + b64[i:i + 120] for i in range(0, len(b64), 120)]
head = open('/tmp/head.txt').read() if os.path.exists('/tmp/head.txt') else None
yml = open(os.path.join(root, '.github', 'workflows', 'android.yml')).read()
start = yml.index("          rm -rf android && base64 -d > a.txz <<'KAB_EOF'\n")
end = yml.index("          tar -xJf a.txz")
block = (ind + "rm -rf android && base64 -d > a.txz <<'KAB_EOF'\n" + '\n'.join(lines) + '\n' + ind + 'KAB_EOF\n'
         + ind + f'echo "{sha}  a.txz" | sha256sum -c || {{ echo "FILE IS CUT OFF: paste the whole yml again"; exit 1; }}\n')
yml = yml[:start] + block + yml[end:]
open(os.path.join(root, '.github', 'workflows', 'android.yml'), 'w').write(yml)
print('ok', len(yml.splitlines()), 'lines', sha)
