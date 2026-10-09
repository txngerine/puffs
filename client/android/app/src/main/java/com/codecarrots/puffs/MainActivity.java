package com.codecarrots.puffs;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Puffs' own native plugins: speech in and out, and phone actions
        registerPlugin(SpeechPlugin.class);
        registerPlugin(TtsPlugin.class);
        registerPlugin(DevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
