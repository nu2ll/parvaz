# Regenerates .github/workflows/android.yml so that the workflow alone can build the app
# (it writes the Android project, copies public/ into the APK as the bundled UI, builds).
import os
root = os.path.dirname(os.path.abspath(__file__))
files = ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties', 'app/build.gradle.kts', 'app/src/main/AndroidManifest.xml',
         'app/src/main/java/app/kabootar/MainActivity.kt', 'app/src/main/res/values/strings.xml', 'app/src/main/res/values/themes.xml',
         'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', 'app/src/main/res/drawable/ic_launcher_foreground.xml']
ind = '          '
lines = []
for f in files:
    content = open(os.path.join(root, f)).read()
    assert 'KAB_EOF' not in content and '${{' not in content
    lines.append(ind + f'mkdir -p "{os.path.dirname("android/" + f)}"')
    lines.append(ind + f"cat > 'android/{f}' <<'KAB_EOF'")
    lines += [(ind + l) if l else '' for l in content.rstrip('\n').split('\n')]
    lines.append(ind + 'KAB_EOF')
gen = '\n'.join(lines)
yml = f'''# Kabootar Android APK. This one file builds everything: it writes the Android project,
# packs the web interface (public/) inside the APK, and builds it.
# Run: Actions → Android APK → Run workflow. Download: the run → Artifacts → kabootar-apk
name: Android APK
on:
  workflow_dispatch:
    inputs:
      server_url:
        description: "Kabootar server URL"
        required: false
        default: "https://kabootar.up.railway.app"
  push:
    paths: [".github/workflows/android.yml", "android/**", "public/**"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create Android project
        shell: bash
        run: |
{gen}
      - name: Pack the interface into the APK
        shell: bash
        run: |
          if [ ! -f public/index.html ]; then echo "public/index.html not found: the Kabootar project must be at the root of the repo"; exit 1; fi
          rm -rf android/app/src/main/assets/web
          mkdir -p android/app/src/main/assets
          cp -r public android/app/src/main/assets/web
          rm -f android/app/src/main/assets/web/sw.js
          echo "packed $(find android/app/src/main/assets/web -type f | wc -l) files"
      - uses: actions/setup-java@v4
        with: {{ distribution: temurin, java-version: "17" }}
      - uses: gradle/actions/setup-gradle@v3
        with: {{ gradle-version: "8.7" }}
      - name: Build APK
        working-directory: android
        env:
          KABOOTAR_URL: ${{{{ github.event.inputs.server_url }}}}
        run: |
          gradle assembleRelease --no-daemon > build.log 2>&1 || {{
            echo "=========== ERROR ==========="
            grep -E "^e: |error:|What went wrong" -A8 build.log | head -80
            exit 1
          }}
      - uses: actions/upload-artifact@v4
        with:
          name: kabootar-apk
          path: android/app/build/outputs/apk/release/*.apk
'''
open(os.path.join(root, '..', '.github', 'workflows', 'android.yml'), 'w').write(yml)
print('ok', len(yml.splitlines()))
