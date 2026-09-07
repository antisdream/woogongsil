package site.woogongsil.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

// [라이트 테마] 웹 화면 전환 전의 네이티브 화면을 밝고 선명하게 유지합니다.
private val LightColors = lightColorScheme(
    primary = WgsBlue,
    secondary = WgsMint,
    background = WgsBackgroundLight,
    surface = WgsBackgroundLight,
)

// [다크 테마] 시스템 다크 모드에서도 오프닝·오류 화면의 대비를 보장합니다.
private val DarkColors = darkColorScheme(
    primary = WgsMint,
    secondary = WgsBlue,
    background = WgsBackgroundDark,
    surface = WgsBackgroundDark,
)

@Composable
fun WoogongsilTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
