package com.crownsync.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CrownSyncBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
