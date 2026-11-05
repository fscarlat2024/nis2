import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?
    // URL din notificarea apasata cand aplicatia era inchisa; se deschide dupa ce porneste WebView-ul
    var pendingURL: URL?

    static let site = URL(string: "https://nis2-app.flscarlat.workers.dev")!
    static let tokenKey = "qtApnsToken"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    // Tokenul APNs se da paginii (nis2-app.flscarlat.workers.dev/app), care il trimite la /api/push/native
    // cu contul autentificat, ca notificarile sa ajunga la persoana potrivita.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: AppDelegate.tokenKey)
        DispatchQueue.main.async {
            (self.bridgeController() as? NIS2BridgeViewController)?.announceToken(token)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs registration failed: \(error)")
    }

    // Notificare primita cu aplicatia deschisa: o afisam oricum
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    // Notificare apasata: deschide pagina din campul "url" (ex. /app/#panou)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let s = response.notification.request.content.userInfo["url"] as? String,
           let url = URL(string: s, relativeTo: AppDelegate.site)?.absoluteURL,
           url.host == AppDelegate.site.host {
            openInWebView(url)
        }
        UIApplication.shared.applicationIconBadgeNumber = 0
        completionHandler()
    }

    func bridgeController() -> CAPBridgeViewController? {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        return scene?.windows.first?.rootViewController as? CAPBridgeViewController
    }

    func openInWebView(_ url: URL) {
        DispatchQueue.main.async {
            if let web = self.bridgeController()?.webView {
                web.load(URLRequest(url: url))
            } else {
                self.pendingURL = url
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    if let u = self.pendingURL { self.pendingURL = nil; self.openInWebView(u) }
                }
            }
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.applicationIconBadgeNumber = 0
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
