package bg.pytechka.app;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		WebStorage.getInstance().deleteAllData();
		CookieManager cookieManager = CookieManager.getInstance();
		cookieManager.removeAllCookies(null);
		cookieManager.flush();

		super.onCreate(savedInstanceState);

		WebView webView = getBridge() != null ? getBridge().getWebView() : null;
		if (webView != null) {
			webView.clearCache(true);
			webView.clearHistory();
		}
	}
}
