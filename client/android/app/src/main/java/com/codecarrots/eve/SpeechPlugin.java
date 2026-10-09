package com.codecarrots.eve;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Speech to text with Android's own recognizer, on-device when the phone has the language pack,
 * so listening works without internet. Events mirror the Web Speech API: result, error, end.
 */
@CapacitorPlugin(
    name = "EveSpeech",
    permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
)
public class SpeechPlugin extends Plugin {
    // Recognizers tried in order, falling back when one has no model for the language:
    // 0 on-device only, 1 the default recognizer preferring offline, 2 the default recognizer online.
    private static final int ON_DEVICE = 0, OFFLINE = 1, ONLINE = 2;
    private SpeechRecognizer recognizer;
    private int session;
    private int firstStage = -1; // where the next session starts: the last stage that had the language
    private boolean downloadRequested;

    private boolean onDeviceAvailable() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    private int startStage() {
        if (firstStage < 0) firstStage = onDeviceAvailable() ? ON_DEVICE : OFFLINE;
        return firstStage;
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        r.put("onDevice", onDeviceAvailable() && startStage() == ON_DEVICE);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "afterMicPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("microphone permission denied", "not-allowed");
    }

    private void begin(PluginCall call) {
        final int id = call.getInt("id", 0);
        final String lang = call.getString("lang", Locale.getDefault().toLanguageTag());
        final boolean interim = Boolean.TRUE.equals(call.getBoolean("interim", true));
        getActivity().runOnUiThread(() -> {
            JSObject r = new JSObject();
            int stage = listen(id, lang, interim, startStage());
            r.put("onDevice", stage == ON_DEVICE);
            r.put("offline", stage != ONLINE);
            call.resolve(r);
        });
    }

    private int listen(int id, String lang, boolean interim, int stage) {
        destroy();
        session = id;
        recognizer = stage == ON_DEVICE
            ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext())
            : SpeechRecognizer.createSpeechRecognizer(getContext());
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, stage != ONLINE);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        recognizer.setRecognitionListener(new Listener(id, lang, interim, stage, intent));
        recognizer.startListening(intent);
        return stage;
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); call.resolve(); });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        getActivity().runOnUiThread(() -> { destroy(); call.resolve(); });
    }

    private void destroy() {
        if (recognizer != null) {
            recognizer.cancel();
            recognizer.destroy();
            recognizer = null;
        }
        session = 0;
    }

    @Override
    protected void handleOnDestroy() {
        destroy();
    }

    private static String errorName(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
            case 11: return "network"; // ERROR_SERVER_DISCONNECTED
            case SpeechRecognizer.ERROR_AUDIO: return "audio-capture";
            case SpeechRecognizer.ERROR_CLIENT: return "aborted";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
            case 13: return "language-not-supported"; // ERROR_LANGUAGE_UNAVAILABLE
            default: return "error-" + code;
        }
    }

    private class Listener implements RecognitionListener {
        private final int id;
        private final String lang;
        private final boolean interim;
        private final int stage;
        private final Intent intent;
        private boolean heard;

        Listener(int id, String lang, boolean interim, int stage, Intent intent) {
            this.id = id; this.lang = lang; this.interim = interim; this.stage = stage; this.intent = intent;
        }

        private boolean current() { return session == id; }

        private void emit(String event, JSObject data) {
            data.put("id", id);
            notifyListeners(event, data);
        }

        private void end() {
            if (!current()) return;
            session = 0;
            emit("end", new JSObject());
        }

        private String text(Bundle b) {
            ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            return list == null || list.isEmpty() ? "" : list.get(0);
        }

        @Override public void onResults(Bundle results) {
            if (!current()) return;
            String t = text(results);
            if (t.isEmpty()) {
                JSObject e = new JSObject(); e.put("error", "no-speech"); emit("error", e);
            } else {
                JSObject r = new JSObject(); r.put("text", t); r.put("final", true); emit("result", r);
            }
            end();
        }

        @Override public void onPartialResults(Bundle partial) {
            if (!current() || !interim) return;
            String t = text(partial);
            if (t.isEmpty()) return;
            heard = true;
            JSObject r = new JSObject(); r.put("text", t); r.put("final", false); emit("result", r);
        }

        @Override public void onError(int code) {
            if (!current()) return;
            // no model for this language here: download it for next time, and use the next recognizer now
            if (!heard && stage < ONLINE && (code == 12 || code == 13)) {
                if (stage == ON_DEVICE && !downloadRequested && Build.VERSION.SDK_INT >= 33 && recognizer != null) {
                    downloadRequested = true;
                    try { recognizer.triggerModelDownload(intent); } catch (Exception ignored) { /* best effort */ }
                }
                firstStage = stage + 1;
                listen(id, lang, interim, stage + 1);
                return;
            }
            JSObject e = new JSObject(); e.put("error", errorName(code)); emit("error", e);
            end();
        }

        @Override public void onReadyForSpeech(Bundle params) { if (current()) emit("start", new JSObject()); }
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}
    }
}
