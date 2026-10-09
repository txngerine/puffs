package com.codecarrots.eve;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eve's own native plugins: speech in and out, and phone actions
        registerPlugin(SpeechPlugin.class);
        registerPlugin(TtsPlugin.class);
        registerPlugin(DevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
