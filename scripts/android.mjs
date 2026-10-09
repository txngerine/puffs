// Builds the Android app: web build -> Capacitor sync -> Gradle debug APK.
//   npm run android           builds client/android/app/build/outputs/apk/debug/app-debug.apk
//   npm run android -- --run  also installs it on the connected phone or running emulator and opens it
// Gradle needs JDK 21 (newer JDKs are too new for Android's Gradle plugin): set JAVA_HOME, or on macOS
// any installed JDK 21 is found automatically.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const client = join(root, 'client'), android = join(client, 'android');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function jdk21() {
  const major = (home) => { try { return +execFileSync(join(home, 'bin/java'), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }).match(/version "(\d+)/)?.[1]; } catch { return 0; } };
  if (process.env.JAVA_HOME && major(process.env.JAVA_HOME) === 21) return process.env.JAVA_HOME;
  if (process.platform === 'darwin') { try { return execSync('/usr/libexec/java_home -v 21', { encoding: 'utf8' }).trim(); } catch { /* none */ } }
  throw new Error('JDK 21 not found. Install Temurin 21 (https://adoptium.net) or set JAVA_HOME to it.');
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
if (!existsSync(sdk)) throw new Error('Android SDK not found. Install Android Studio or set ANDROID_HOME.');
const env = { ...process.env, JAVA_HOME: jdk21(), ANDROID_HOME: sdk };

run('npm', ['run', 'build'], { cwd: client });
run('npx', ['cap', 'sync', 'android'], { cwd: client, env });
run('./gradlew', ['assembleDebug', '-q'], { cwd: android, env });
const apk = join(android, 'app/build/outputs/apk/debug/app-debug.apk');
console.log('\nAPK: ' + apk);

if (process.argv.includes('--run')) {
  const adb = join(sdk, 'platform-tools/adb');
  run(adb, ['install', '-r', apk]);
  run(adb, ['shell', 'am', 'start', '-n', 'com.codecarrots.eve/.MainActivity']);
}
