import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = NIS2BridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// WebView-ul cu nis2-app.flscarlat.workers.dev/app. La inceputul fiecarei pagini spune site-ului ca ruleaza in
/// aplicatia iOS (window.NIS2_NATIVE) si, daca exista, ii da tokenul de notificari (window.NIS2_NATIVE_PUSH);
/// site-ul il inregistreaza pe contul autentificat.
class NIS2BridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let content = webView?.configuration.userContentController else { return }
        content.addUserScript(WKUserScript(source: "window.NIS2_NATIVE='ios';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let token = UserDefaults.standard.string(forKey: AppDelegate.tokenKey) {
            content.addUserScript(WKUserScript(source: tokenJS(token, notify: false), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    private func tokenJS(_ token: String, notify: Bool) -> String {
        let set = "window.NIS2_NATIVE_PUSH={platform:'ios',token:'\(token)'};"
        return notify ? set + "window.dispatchEvent(new Event('nis2-native-push'));" : set
    }

    /// Tokenul a sosit dupa ce pagina s-a incarcat: il dam paginii curente si celor urmatoare.
    func announceToken(_ token: String) {
        guard let web = webView else { return }
        web.configuration.userContentController.addUserScript(
            WKUserScript(source: tokenJS(token, notify: false), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web.evaluateJavaScript(tokenJS(token, notify: true), completionHandler: nil)
    }
}
