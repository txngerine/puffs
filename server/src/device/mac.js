// Actions on the Mac the server runs on: open apps, look up contacts, send WhatsApp messages.
// Everything here works without internet (WhatsApp itself delivers the message once it is online).
// No shell is involved: arguments go to `open` and `osascript` as argv, never interpolated into code.
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

let execFile = promisify(execFileCb);
export function _setExec(fn) { execFile = fn; } // tests

const run = async (cmd, args, timeout = 15000) => (await execFile(cmd, args, { timeout })).stdout.trim();
const osa = (script, ...argv) => run('osascript', ['-e', script, ...argv]);

export const supported = () => process.platform === 'darwin';

// App names as people say them -> the name macOS knows
const ALIASES = { whatsapp: 'WhatsApp', 'whats app': 'WhatsApp', chrome: 'Google Chrome', 'google chrome': 'Google Chrome', vscode: 'Visual Studio Code', 'vs code': 'Visual Studio Code', 'app store': 'App Store', settings: 'System Settings', 'system preferences': 'System Settings', facetime: 'FaceTime', itunes: 'Music' };
export const appName = (name) => ALIASES[name.toLowerCase().trim()] || name.trim();

export async function installed(app) {
  try { await run('open', ['-Ra', appName(app)], 5000); return true; } catch { return false; }
}

export async function openApp(app) {
  await run('open', ['-a', appName(app)]);
  return appName(app);
}

// macOS Contacts -> { name, phone } (mobile first). The first call asks for Contacts permission.
const CONTACT_SCRIPT = `on run argv
  set q to item 1 of argv
  tell application "Contacts"
    set ps to every person whose name contains q
    if ps is {} then set ps to every person whose nickname contains q
    if ps is {} then return ""
    set p to item 1 of ps
    set best to ""
    repeat with ph in phones of p
      set l to ""
      try
        set l to label of ph
      end try
      if best is "" or l contains "mobile" or l contains "iPhone" or l contains "WhatsApp" then set best to value of ph
    end repeat
    if best is "" then return ""
    return (name of p) & tab & best
  end tell
end run`;
export async function lookupContact(name) {
  const out = await osa(CONTACT_SCRIPT, name);
  if (!out) return null;
  const [full, phone] = out.split('\t');
  return { name: full, phone };
}

// Opens the chat with the message typed in, then presses Return to send it.
// Pressing Return needs Accessibility permission for the app running the server (Terminal, iTerm, VS Code...).
// Without it the message is left ready in WhatsApp and the result is 'drafted'.
const SEND_SCRIPT = `on run argv
  set wasRunning to application "WhatsApp" is running
  open location (item 1 of argv)
  if wasRunning then
    delay 1.5
  else
    delay 6
  end if
  tell application "WhatsApp" to activate
  delay 0.4
  tell application "System Events" to tell process "WhatsApp" to key code 36
end run`;
export const digits = (phone) => String(phone || '').replace(/[^\d]/g, '');

export async function sendWhatsApp({ phone, text, send = true }) {
  const url = 'whatsapp://send?phone=' + digits(phone) + '&text=' + encodeURIComponent(text);
  if (!send) { await run('open', [url]); return 'drafted'; }
  try {
    await osa(SEND_SCRIPT, url);
    return 'sent';
  } catch (e) {
    // -1719 / -25211 / 1002: not allowed to send keystrokes. The chat is open with the text typed in.
    if (/assistive|accessibility|not allowed|-1719|-25211|1002/i.test(String(e.stderr || e.message))) return 'drafted';
    throw e;
  }
}
