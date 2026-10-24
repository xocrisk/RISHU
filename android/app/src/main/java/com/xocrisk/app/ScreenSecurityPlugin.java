package com.xocrisk.app;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Blocks screenshots, screen recording and the recent-apps preview while a chat is open. */
@CapacitorPlugin(name = "ScreenSecurity")
public class ScreenSecurityPlugin extends Plugin {
    @PluginMethod
    public void enable(PluginCall call) { set(call, true); }

    @PluginMethod
    public void disable(PluginCall call) { set(call, false); }

    private void set(PluginCall call, boolean secure) {
        getActivity().runOnUiThread(() -> {
            if (secure) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
