package ro.netcomm.nis2;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

// Afiseaza notificarea si cand aplicatia e deschisa (in fundal o afiseaza sistemul).
// Tokenul nou ajunge la site la urmatoarea pagina incarcata (MainActivity il da paginii).
public class NIS2MessagingService extends FirebaseMessagingService {
    static final String CHANNEL = "anunturi";

    @Override
    public void onNewToken(@NonNull String token) {
        MainActivity.tokenChanged(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        RemoteMessage.Notification n = msg.getNotification();
        String title = n != null ? n.getTitle() : msg.getData().get("title");
        String body = n != null ? n.getBody() : msg.getData().get("body");
        if (title == null && body == null) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Incidente și termene", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        String url = msg.getData().get("url");
        if (url != null) open.putExtra("url", url);
        PendingIntent pi = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi);
        nm.notify((int) System.currentTimeMillis(), b.build());
    }
}
