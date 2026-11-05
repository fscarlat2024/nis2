package ro.netcomm.nis2;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.Collections;

// Aplicatia Android Scut NIS2: nis2-app.flscarlat.workers.dev/app intr-un WebView (Capacitor).
// La inceputul fiecarei pagini spune site-ului ca ruleaza in aplicatie (window.NIS2_NATIVE) si ii da
// tokenul de notificari FCM (window.NIS2_NATIVE_PUSH); site-ul il leaga de contul autentificat.
// Fara google-services.json (Firebase neconfigurat) aplicatia merge, doar fara notificari.
public class MainActivity extends BridgeActivity {
    static final String SITE = "https://nis2-app.flscarlat.workers.dev";
    private static String token;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(web, "window.NIS2_NATIVE='android';", Collections.singleton(SITE));
            }
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    view.evaluateJavascript("window.NIS2_NATIVE='android';", null);
                    if (token != null) announce(view, token);
                }
            });
        }
        if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(
                new android.app.NotificationChannel(NIS2MessagingService.CHANNEL, "Incidente și termene", android.app.NotificationManager.IMPORTANCE_HIGH));
        }
        if (!FirebaseApp.getApps(this).isEmpty()) {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t -> {
                token = t;
                if (getBridge() != null) announce(getBridge().getWebView(), t);
            });
        }
        openUrlFromIntent(getIntent());
    }

    // tokenul ajunge la pagina curenta; site-ul il trimite la /api/push/native cu contul logat
    static void announce(WebView web, String t) {
        if (web == null || t == null || !t.matches("[A-Za-z0-9:_\\-]+")) return;
        web.post(() -> web.evaluateJavascript(
            "window.NIS2_NATIVE='android';window.NIS2_NATIVE_PUSH={platform:'android',token:'" + t + "'};window.dispatchEvent(new Event('nis2-native-push'));", null));
    }

    static void tokenChanged(String t) { token = t; }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openUrlFromIntent(intent);
    }

    // notificare apasata: deschide pagina din campul "url" (ex. /app/#panou), doar pe nis2-app.flscarlat.workers.dev
    private void openUrlFromIntent(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String url = intent.getStringExtra("url");
        if (url == null) return;
        if (url.startsWith("/")) url = SITE + url;
        if (!url.startsWith(SITE + "/")) return;
        final String target = url;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
}
