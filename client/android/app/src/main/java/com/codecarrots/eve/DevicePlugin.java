package com.codecarrots.puffs;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;
import java.util.Locale;

/** Phone actions: open apps, find contacts, send WhatsApp messages. All of it works offline. */
@CapacitorPlugin(
    name = "PuffsDevice",
    permissions = @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
)
public class DevicePlugin extends Plugin {
    private static final String[] WHATSAPP = { "com.whatsapp", "com.whatsapp.w4b" };
    private static final long SEND_TIMEOUT_MS = 15000;

    private static String squash(String s) { return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", ""); }

    /* ----- apps ----- */
    @PluginMethod
    public void openApp(PluginCall call) {
        String want = squash(call.getString("name", ""));
        if (want.isEmpty()) { call.reject("app name is required", "invalid"); return; }
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo app : apps) {
            String label = squash(String.valueOf(app.loadLabel(pm)));
            int score = label.equals(want) ? 3 : label.startsWith(want) ? 2 : label.contains(want) && want.length() >= 3 ? 1 : 0;
            if (score > bestScore) { best = app; bestScore = score; }
        }
        if (best == null) { call.reject("not installed", "missing"); return; }
        Intent launch = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setComponent(new ComponentName(best.activityInfo.packageName, best.activityInfo.name))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        getActivity().startActivity(launch);
        JSObject r = new JSObject();
        r.put("app", String.valueOf(best.loadLabel(pm)));
        call.resolve(r);
    }

    /* ----- contacts ----- */
    @PluginMethod
    public void findContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "afterContactsPermission");
            return;
        }
        lookup(call);
    }

    @PermissionCallback
    private void afterContactsPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) lookup(call);
        else call.reject("contacts permission denied", "denied");
    }

    private void lookup(PluginCall call) {
        String name = call.getString("name", "").trim();
        if (name.isEmpty()) { call.reject("name is required", "invalid"); return; }
        String[] cols = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
        };
        String bestName = null, bestPhone = null;
        int bestScore = -1;
        try (Cursor c = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?", new String[] { "%" + name + "%" }, null)) {
            while (c != null && c.moveToNext()) {
                String n = c.getString(0), p = c.getString(1);
                int type = c.getInt(2);
                // an exact name beats a partial one; a mobile number beats a landline
                int score = (n.equalsIgnoreCase(name) ? 4 : n.toLowerCase(Locale.ROOT).startsWith(name.toLowerCase(Locale.ROOT)) ? 2 : 0)
                    + (type == ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE ? 1 : 0);
                if (score > bestScore) { bestScore = score; bestName = n; bestPhone = p; }
            }
        }
        if (bestPhone == null) { call.reject("no such contact", "missing"); return; }
        JSObject r = new JSObject();
        r.put("name", bestName);
        r.put("phone", bestPhone);
        call.resolve(r);
    }

    /* ----- WhatsApp ----- */
    private String whatsappPackage() {
        PackageManager pm = getContext().getPackageManager();
        for (String pkg : WHATSAPP) {
            try { pm.getPackageInfo(pkg, 0); return pkg; } catch (PackageManager.NameNotFoundException ignored) { /* next */ }
        }
        return null;
    }

    private boolean autoSendEnabled() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        ComponentName me = new ComponentName(getContext(), SendService.class);
        return enabled != null && (enabled.contains(me.flattenToString()) || enabled.contains(me.flattenToShortString()));
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("whatsapp", whatsappPackage() != null);
        r.put("autoSend", autoSendEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void sendWhatsApp(PluginCall call) {
        String phone = call.getString("phone", "").replaceAll("\\D", "");
        String text = call.getString("text", "");
        if (phone.length() < 7 || phone.length() > 15) { call.reject("a phone number with country code is required", "invalid"); return; }
        if (text.trim().isEmpty()) { call.reject("text is required", "invalid"); return; }
        String pkg = whatsappPackage();
        if (pkg == null) { call.reject("WhatsApp is not installed", "missing"); return; }

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=" + phone + "&text=" + Uri.encode(text)))
            .setPackage(pkg);
        boolean auto = autoSendEnabled() && !Boolean.FALSE.equals(call.getBoolean("send", true));
        if (auto) {
            Handler main = new Handler(Looper.getMainLooper());
            Runnable timeout = () -> { if (SendService.disarm()) resolve(call, "drafted", true); };
            SendService.arm(pkg, () -> { main.removeCallbacks(timeout); resolve(call, "sent", true); });
            main.postDelayed(timeout, SEND_TIMEOUT_MS);
        }
        getActivity().startActivity(open);
        if (!auto) resolve(call, "drafted", false);
    }

    private static void resolve(PluginCall call, String status, boolean autoSend) {
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("autoSend", autoSend);
        call.resolve(r);
    }

    @PluginMethod
    public void openAutoSendSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }
}
