# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class org.lectorlibre.reader.* {
  native <methods>;
}

-keep class org.lectorlibre.reader.WryActivity {
  public <init>(...);

  void setWebView(org.lectorlibre.reader.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class org.lectorlibre.reader.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class org.lectorlibre.reader.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class org.lectorlibre.reader.RustWebChromeClient,org.lectorlibre.reader.RustWebViewClient {
  public <init>(...);
}
