package com.codecarrots.eve;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * Taps WhatsApp's send button for a message Eve just opened, then brings Eve back.
 * It acts only while armed: for a few seconds after you confirmed a message, and only in WhatsApp.
 * The user turns it on once in Settings > Accessibility.
 */
public class SendService extends AccessibilityService {
    private static final long ARMED_FOR_MS = 15000;
    private static volatile String armedPackage;
    private static volatile long armedAt;
    private static volatile Runnable onSent;

    static synchronized void arm(String pkg, Runnable sent) {
        armedPackage = pkg;
        armedAt = SystemClock.elapsedRealtime();
        onSent = sent;
    }

    /** @return true if it was still armed (nothing was sent) */
    static synchronized boolean disarm() {
        boolean was = armedPackage != null;
        armedPackage = null;
        onSent = null;
        return was;
    }

    private static synchronized Runnable take() {
        Runnable r = onSent;
        armedPackage = null;
        onSent = null;
        return r;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        String pkg = armedPackage;
        if (pkg == null || event.getPackageName() == null || !pkg.contentEquals(event.getPackageName())) return;
        if (SystemClock.elapsedRealtime() - armedAt > ARMED_FOR_MS) { disarm(); return; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        // wait until the chat shows the message in the text box, so the tap sends exactly that
        List<AccessibilityNodeInfo> entry = root.findAccessibilityNodeInfosByViewId(pkg + ":id/entry");
        if (!entry.isEmpty() && (entry.get(0).getText() == null || entry.get(0).getText().length() == 0)) return;

        AccessibilityNodeInfo send = find(root, pkg);
        if (send == null) return;
        if (!send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
        Runnable done = take();
        if (done != null) done.run();
        // back to Eve once WhatsApp has the message
        new Handler(Looper.getMainLooper()).postDelayed(() -> startActivity(
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)), 900);
    }

    private static AccessibilityNodeInfo find(AccessibilityNodeInfo root, String pkg) {
        for (AccessibilityNodeInfo n : root.findAccessibilityNodeInfosByViewId(pkg + ":id/send")) {
            AccessibilityNodeInfo c = clickable(n);
            if (c != null) return c;
        }
        // other WhatsApp versions: the button described as "Send"
        for (AccessibilityNodeInfo n : root.findAccessibilityNodeInfosByText("Send")) {
            CharSequence d = n.getContentDescription();
            if (d != null && d.toString().equalsIgnoreCase("send")) {
                AccessibilityNodeInfo c = clickable(n);
                if (c != null) return c;
            }
        }
        return null;
    }

    private static AccessibilityNodeInfo clickable(AccessibilityNodeInfo n) {
        for (int i = 0; n != null && i < 3; i++, n = n.getParent()) if (n.isClickable() && n.isEnabled()) return n;
        return null;
    }

    @Override
    public void onInterrupt() {}
}
