package com.codecarrots.eve;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Text to speech with the phone's own engine; voices that need no network work offline. */
@CapacitorPlugin(name = "EveTts")
public class TtsPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready;
    private final List<PluginCall> waiting = new ArrayList<>();

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            List<PluginCall> calls;
            synchronized (waiting) { calls = new ArrayList<>(waiting); waiting.clear(); }
            for (PluginCall c : calls) voices(c);
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            private void emit(String event, String id) { JSObject d = new JSObject(); d.put("id", id); notifyListeners(event, d); }
            @Override public void onStart(String id) { emit("start", id); }
            @Override public void onDone(String id) { emit("done", id); }
            @Override public void onStop(String id, boolean interrupted) { emit("done", id); }
            @Override @Deprecated public void onError(String id) { emit("error", id); }
            @Override public void onError(String id, int code) { emit("error", id); }
            @Override public void onRangeStart(String id, int start, int end, int frame) { emit("boundary", id); }
        });
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        if (!ready) { synchronized (waiting) { waiting.add(call); } return; }
        voices(call);
    }

    private void voices(PluginCall call) {
        JSArray list = new JSArray();
        if (ready && tts.getVoices() != null) {
            for (Voice v : tts.getVoices()) {
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                JSObject o = new JSObject();
                o.put("name", v.getName());
                o.put("lang", v.getLocale().toLanguageTag());
                o.put("local", !v.isNetworkConnectionRequired());
                o.put("quality", v.getQuality());
                list.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("voices", list);
        r.put("ready", ready);
        call.resolve(r);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!ready) { call.reject("text to speech is not ready"); return; }
        String text = call.getString("text", "");
        String id = call.getString("id", "u");
        String name = call.getString("voice", "");
        Voice chosen = null;
        if (name != null && !name.isEmpty() && tts.getVoices() != null) {
            for (Voice v : tts.getVoices()) if (v.getName().equals(name)) { chosen = v; break; }
        }
        if (chosen != null) tts.setVoice(chosen);
        else {
            String lang = call.getString("lang", "");
            if (lang != null && !lang.isEmpty()) tts.setLanguage(Locale.forLanguageTag(lang));
        }
        tts.setSpeechRate(call.getFloat("rate", 1f));
        tts.setPitch(call.getFloat("pitch", 1f));
        tts.speak(text, TextToSpeech.QUEUE_ADD, new Bundle(), id);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
    }
}
